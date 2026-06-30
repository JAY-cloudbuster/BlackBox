require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { z } = require('zod');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const docx = require('docx');

const { db, insertDocument, insertEntities, insertOverride, insertExportLog, getDocumentWithEntities, getLatestOverrides } = require('./db/index');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Initialize Groq Client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const documentSchema = z.object({
  plainTextDocument: z.string(),
  entities: z.array(z.object({
    id: z.string().optional(),
    text: z.string(),
    startIndex: z.number(),
    endIndex: z.number(),
    entityType: z.string(),
    layer: z.enum(["critical", "ambiguous", "visible"]),
    confidenceScore: z.number().min(0).max(100),
    reasoning: z.string(),
    defaultAction: z.enum(["redact", "flag", "show"])
  }))
});

const baseSystemPrompt = `You are an elite privacy redaction AI. Your job is to analyze the provided text and identify Personally Identifiable Information (PII), sensitive financial data, and sensitive medical data.

You must return ONLY a JSON object. DO NOT include markdown formatting, code blocks (like \`\`\`json), or conversational text. Output raw, parsable JSON.

Schema:
{
  "plainTextDocument": "The exact original document text provided by the user, completely unmodified.",
  "entities": [
    {
      "text": "the exact substring from the original document.",
      "startIndex": integer (0-indexed start character position in plainTextDocument),
      "endIndex": integer (0-indexed end character position in plainTextDocument),
      "entityType": "string (e.g. 'SSN', 'email', 'name', 'address', 'organization', 'location', 'system_artifact', 'ambiguous')",
      "layer": "critical" | "ambiguous" | "visible",
      "confidenceScore": number (0-100),
      "reasoning": "plain-English explanation of why this layer was chosen",
      "defaultAction": "redact" | "flag" | "show"
    }
  ]
}

LAYER DEFINITIONS:
- LAYER 1 (critical): Highly confident sensitive data (SSNs, accounts, names tied to finance/medical, addresses, emails). defaultAction MUST be "redact".
- LAYER 2 (ambiguous): Contextually sensitive. Partial identifiers, ambiguous names. defaultAction MUST be "flag".
- LAYER 3 (visible): Deliberately kept visible. Public locations, public company names, automated signatures. defaultAction MUST be "show".

CRITICAL INSTRUCTIONS:
1. Every entity MUST include reasoning, even Layer 1 critical ones.
2. Ensure startIndex and endIndex exactly match the text substring in plainTextDocument.
3. Output ONLY raw JSON matching the exact schema above. Any deviation will cause a system crash.`;

// Pure function to deliberately surface low-confidence criticals for human review
function calibrateEntityLayer(entity) {
  if (entity.layer === 'critical' && entity.confidenceScore < 60) {
    return {
      ...entity,
      layer: 'ambiguous',
      defaultAction: 'flag',
      reasoning: entity.reasoning + " (Confidence below threshold — flagged for review rather than auto-redacted.)"
    };
  }
  return entity;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function fetchGroqAnalysis(text, retryCount = 0) {
  let prompt = baseSystemPrompt;
  if (retryCount > 0) {
    prompt += "\n\nCRITICAL REMINDER: Your previous response failed schema validation. You MUST respond with ONLY valid JSON perfectly matching the schema. Do not wrap in markdown.";
  }

  const makeRequest = async () => {
    return await groq.chat.completions.create({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: text }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });
  };

  const withTimeout = (promise, ms) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        const err = new Error("timeout");
        err.code = "timeout";
        reject(err);
      }, ms);
    });
    return Promise.race([
      promise.finally(() => clearTimeout(timeoutId)),
      timeoutPromise
    ]);
  };

  try {
    const chatCompletion = await withTimeout(makeRequest(), 15000);
    return chatCompletion.choices[0].message.content;
  } catch (error) {
    if (error.code === 'timeout') {
      throw error;
    }
    
    // Check if it's a 429 rate limit error
    if (error.status === 429 || (error.message && error.message.includes('429'))) {
      console.log("Rate limited (429) by Groq. Waiting 2s before retry...");
      await delay(2000);
      try {
        const retryCompletion = await withTimeout(makeRequest(), 15000);
        return retryCompletion.choices[0].message.content;
      } catch (retryError) {
        if (retryError.status === 429 || (retryError.message && retryError.message.includes('429'))) {
          const err = new Error("rate_limited");
          err.code = "rate_limited";
          throw err;
        }
        if (retryError.code === 'timeout') throw retryError;
        throw retryError;
      }
    }
    throw error;
  }
}

async function processDocumentText(text, sourceFilename = null) {
  if (!text || text.trim() === '') {
    throw { status: 400, code: 'empty_document', message: "Document text cannot be empty." };
  }
  if (text.length > 50000) {
    throw { status: 400, code: 'payload_too_large', message: "Document text exceeds the 50,000 character limit." };
  }

  console.log("Analyzing document with Groq LLM...");
  let llmResponse;
  let parsedData;
  
  try {
    llmResponse = await fetchGroqAnalysis(text);
    try {
      parsedData = JSON.parse(llmResponse);
      documentSchema.parse(parsedData);
    } catch (e) {
      console.log("Validation failed on first attempt, retrying schema enforcement...");
      llmResponse = await fetchGroqAnalysis(text, 1);
      parsedData = JSON.parse(llmResponse);
      documentSchema.parse(parsedData); 
    }
  } catch (llmError) {
    console.error("Groq Engine Error:", llmError.message);
    
    if (llmError.code === 'timeout') {
      throw { status: 504, code: 'timeout', message: "Analysis is taking longer than expected. Try a shorter document or try again." };
    }
    if (llmError.code === 'rate_limited') {
      throw { status: 429, code: 'rate_limited', message: "Too many requests to the AI engine. Please wait a moment and try again." };
    }
    if (llmError instanceof z.ZodError || llmError instanceof SyntaxError) {
      throw { status: 500, code: 'invalid_schema', message: "LLM Output Schema Validation Failed after retry. The AI returned a malformed format." };
    }
    
    throw { status: 500, code: 'unknown', message: "Failed to connect to AI Engine or LLM provider." };
  }

  const docId = crypto.randomUUID();
  insertDocument(docId, parsedData.plainTextDocument, sourceFilename);

  parsedData.entities = parsedData.entities.map(e => ({
    ...e,
    id: crypto.randomUUID()
  })).map(calibrateEntityLayer);

  insertEntities(docId, parsedData.entities);
  console.log("Groq analysis complete and persisted to SQLite!");
  
  return { documentId: docId, ...parsedData, overrides: {} };
}

// POST /api/documents
app.post('/api/documents', upload.single('file'), async (req, res) => {
  try {
    let text = req.body.text;
    let sourceFilename = null;
    
    if (req.file) {
      if (req.file.mimetype !== 'text/plain') {
        return res.status(400).json({ error: true, code: 'invalid_file', message: "Only .txt files are supported here." });
      }
      text = req.file.buffer.toString('utf-8');
      sourceFilename = req.file.originalname;
    }

    const result = await processDocumentText(text, sourceFilename);
    res.json(result);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: true, code: error.code, message: error.message });
    }
    console.error("Fatal Backend Error:", error);
    res.status(500).json({ error: true, code: 'internal_error', message: "An unexpected internal server error occurred." });
  }
});

// POST /api/documents/upload
app.post('/api/documents/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: true, code: 'invalid_file', message: "Only .pdf files are supported for this endpoint." });
    }
    
    let text;
    try {
      const pdfData = await pdfParse(req.file.buffer);
      text = pdfData.text;
    } catch (e) {
      return res.status(400).json({ error: true, code: 'pdf_parse_error', message: "Failed to parse PDF file." });
    }

    if (!text || text.trim() === '') {
      return res.status(400).json({ error: true, code: 'no_extractable_text', message: "This PDF appears to be a scanned image with no selectable text. Try a text-based PDF." });
    }

    const result = await processDocumentText(text, req.file.originalname);
    res.json(result);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: true, code: error.code, message: error.message });
    }
    console.error("Fatal Backend Error:", error);
    res.status(500).json({ error: true, code: 'internal_error', message: "An unexpected internal server error occurred." });
  }
});


// GET /api/documents/:id
app.get('/api/documents/:id', (req, res) => {
  try {
    const docId = req.params.id;
    const document = getDocumentWithEntities(docId);
    
    if (!document) {
      return res.status(404).json({ error: true, code: 'not_found', message: "Document not found." });
    }
    
    const overrides = getLatestOverrides(docId);
    res.json({ documentId: docId, ...document, overrides });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: true, code: 'internal_error', message: "Failed to retrieve document." });
  }
});

// POST /api/entities/:id/override
app.post('/api/entities/:id/override', (req, res) => {
  try {
    const entityId = req.params.id;
    const { action } = req.body;
    
    if (!['redact', 'show', 'reset'].includes(action)) {
      return res.status(400).json({ error: true, code: 'invalid_action', message: "Invalid action." });
    }
    
    const overrideId = crypto.randomUUID();
    insertOverride(overrideId, entityId, action);
    
    res.json({ success: true, overrideId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: true, code: 'internal_error', message: "Failed to save override." });
  }
});

// POST /api/documents/:id/export
app.post('/api/documents/:id/export', async (req, res) => {
  try {
    const docId = req.params.id;
    const { format, overrides } = req.body;
    
    if (!['pdf', 'docx', 'txt'].includes(format)) {
      return res.status(400).json({ error: true, message: "Invalid format." });
    }

    const document = getDocumentWithEntities(docId);
    if (!document) {
      return res.status(404).json({ error: true, message: "Document not found." });
    }

    // Sort entities descending by index so string replacements don't shift subsequent indices
    const entities = [...document.entities].sort((a, b) => b.startIndex - a.startIndex);
    
    let redactedText = document.plainTextDocument;
    
    for (const entity of entities) {
      const userOverride = overrides && overrides[entity.id] !== undefined ? overrides[entity.id] : null;
      const finalAction = userOverride !== null ? userOverride : entity.defaultAction;
      
      if (finalAction !== 'show') {
        // Only redact if the entity is actually within bounds (safety check)
        if (entity.startIndex >= 0 && entity.endIndex <= redactedText.length) {
          const spanLength = entity.endIndex - entity.startIndex;
          const replacement = '█'.repeat(spanLength);
          redactedText = redactedText.substring(0, entity.startIndex) + replacement + redactedText.substring(entity.endIndex);
        }
      }
    }
    
    insertExportLog(crypto.randomUUID(), docId, format);
    
    const filename = `conseal-export-${docId}.${format}`;
    
    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(redactedText);
    }
    
    if (format === 'pdf') {
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = 11;
      const margin = 50;
      let page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      
      let y = height - margin;
      
      const breakLines = (text, maxWidth, font, fontSize) => {
        if (!text) return [];
        const words = text.split(' ');
        let lines = [];
        let currentLine = words[0] || '';
        
        for (let i = 1; i < words.length; i++) {
          const word = words[i];
          const textWidth = font.widthOfTextAtSize(currentLine + ' ' + word, fontSize);
          if (textWidth < maxWidth) {
            currentLine += ' ' + word;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) lines.push(currentLine);
        return lines;
      };

      const rawLines = redactedText.split('\n');
      for (const rawLine of rawLines) {
        if (rawLine.trim() === '') {
           y -= (fontSize + 6);
           continue;
        }
        const wrappedLines = breakLines(rawLine, width - 2*margin, font, fontSize);
        for (const line of wrappedLines) {
          if (y < margin) {
            page = pdfDoc.addPage();
            y = height - margin;
          }
          page.drawText(line, { x: margin, y, size: fontSize, font });
          y -= (fontSize + 6);
        }
      }
      
      const pdfBytes = await pdfDoc.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(Buffer.from(pdfBytes));
    }
    
    if (format === 'docx') {
      const doc = new docx.Document({
        sections: [{
          properties: {},
          children: redactedText.split('\n').map(text => new docx.Paragraph({ children: [new docx.TextRun(text)] }))
        }]
      });
      const b64string = await docx.Packer.toBase64String(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(Buffer.from(b64string, 'base64'));
    }

  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).json({ error: true, message: "Failed to generate export." });
  }
});

app.listen(PORT, () => {
  console.log(`Conseal Backend is running on http://localhost:${PORT}`);
  console.log(`Live LLM Integration (Groq) is ACTIVE!`);
  console.log(`Persistent SQLite Database is ACTIVE!`);
});
