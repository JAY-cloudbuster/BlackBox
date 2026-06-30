require('dotenv').config();
const { PDFParse } = require('pdf-parse');
const { db, insertDocument, insertEntities, getDocumentWithEntities, insertOverride, insertExportLog, getLatestOverrides } = require('./db/index');
const Groq = require('groq-sdk');
const { z } = require('zod');
const crypto = require('crypto');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const docx = require('docx');
const Tesseract = require('tesseract.js');

const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

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
    entityType: z.enum(["NAME", "EMAIL", "PHONE", "URL", "ORG", "ADDRESS", "ROLE", "SSN", "ACCOUNT_NUMBER", "CARD_NUMBER", "ID_NUMBER", "DATE", "PASSWORD", "OTHER"]),
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
      "entityType": "string (MUST BE EXACTLY ONE OF: NAME, EMAIL, PHONE, URL, ORG, ADDRESS, ROLE, SSN, ACCOUNT_NUMBER, CARD_NUMBER, ID_NUMBER, DATE, PASSWORD, OTHER)",
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

1. ROLE AND STAKES:
This system protects real sensitive data. Under-redaction (missing real PII) is a catastrophic failure. Precision in WHICH characters get flagged is critical because the redaction is applied exactly to the character level.
Do not let the absence of a recognizable data PATTERN (digits, @ symbols, known formats) cause you to under-flag an entity. Plain names and organization names are just as real an entity category as numeric identifiers — apply the same rigor to identifying them as you do to scanning for SSNs or account numbers.

2. THE LABEL-VALUE DECISION PROCEDURE (Apply this algorithm to every entity):
Step 1: Determine if this text is DESCRIBING a category of information (a label) or IS the actual sensitive data (a value). Ask: 'If I deleted this exact text, would the actual sensitive secret be gone, or would only a description of what kind of secret it is be gone?' If deleting it only removes a description, it's a label — never flag it. If deleting it removes the actual identifying data, it's a value — flag it.
Step 2: Labels can take many forms: 'Social Security Number:', 'SSN:', 'Social Security #', 'SS No.', or even no explicit label at all with the value embedded in prose ('his social security number, 412-09-7734, was verified'). In ALL of these forms, your job is to find where the actual digits/data string begins and ends, and flag ONLY that span, regardless of how the label preceding it is phrased or formatted.
Step 3: Values are not always immediately after a colon. They may appear in a table cell, on the next line, or embedded mid-sentence. Locate the actual data value wherever it is in the text, using the surrounding context as a clue to what type of data it is, but always flag the value's character span, never the contextual/descriptive text around it.

3. ALWAYS-CRITICAL CATEGORIES:
SSNs, full bank account numbers, full credit/debit card numbers, passwords, and full government ID numbers are ALWAYS Critical. Apply this regardless of formatting variation. A SSN may appear as 412-09-7734, 412097734, or 4l2-O9-7734 (an OCR/typo variant) — if it is structurally consistent with an SSN pattern (9 digits in a recognizable grouping) treat it as Critical even if formatting is slightly irregular.

4. RELATIONAL CONTEXT RULE FOR NAMES, EMPLOYERS, AND RELATIONSHIPS:
Many sensitive entities are NOT numbers or obviously-formatted data — they are plain names, organization names, or descriptions of relationships. These require contextual judgment, which you must apply using this procedure:

Step 1 — Identify the RELATIONAL ROLE of each name or organization mentioned. Ask: 'What is this name's relationship to the document's primary subject (the person whose record this is)?' Common roles include: the subject themselves, a family member or emergency contact, a manager or colleague, a former or current employer, a service provider (bank, insurer, doctor), or an unrelated public reference.

Step 2 — Apply this default sensitivity by relational role, then adjust based on surrounding context:
  - The subject's own full name: Critical (always)
  - Family members, emergency contacts, and their identifying details: Critical
  - Direct managers/colleagues named WITH their contact information nearby: Ambiguous — flag for review, since the name itself plus a working email forms a more identifying combination than either alone
  - Current or former employers mentioned in an HR/personal context (e.g. 'previously worked at X', 'joined X', employment history): Ambiguous — employment history is commonly considered sensitive personal/professional information, even though a company name alone is not secret
  - Service providers (insurance company, bank name) mentioned WITHOUT an adjacent account/policy number: Visible — the provider name alone is low-risk
  - Service providers mentioned immediately adjacent to (within the same line or field group as) a flagged Critical identifier (account number, policy number): Ambiguous — flag the provider name too, since the pairing of 'who' and 'which number' together is more identifying than the number alone
  - Names or organizations mentioned only as general/public context with no tie to the document subject's personal record (e.g. 'this is a well-known industry practice at companies like X'): Visible

Step 3 — When in doubt between Ambiguous and Visible for a name or organization, prefer Ambiguous. Under-flagging a name that should have been reviewable by a human is a worse outcome than asking the user to make one extra click on something that turns out to be fine.

5. PUBLIC-INFORMATION REASONING:
If the sentence containing an entity is making a factual, neutral statement about a company, organization, or location's well-known status (industry, headquarters, public role) rather than connecting it to a private individual's personal circumstances, lean toward Visible. If you are uncertain whether something is public information, prefer Ambiguous (flag for human review) over Critical — humans reviewing a flagged-but-visible item is a much smaller cost than the system implying something is dangerous when it isn't, and far smaller than hiding something that didn't need hiding.

6. SELF-CHECK INSTRUCTION:
Before finalizing each entity in your output, re-read the exact substring your startIndex/endIndex will produce. Confirm internally: does this substring contain the actual sensitive value, or did I accidentally capture a label, a partial word, or surrounding punctuation? Adjust startIndex/endIndex if needed so the captured substring is precisely the sensitive data and nothing else.

6. Output ONLY raw JSON matching the exact schema above. Any deviation will cause a system crash.`;

// NEW Step 0: Resolve LLM Index Hallucinations computationally
function resolveIndexHallucinations(rawText, entities) {
  return entities.map(entity => {
    const extracted = rawText.substring(entity.startIndex, entity.endIndex);
    if (extracted === entity.text) return entity;
    
    const isNumericType = ['ssn', 'account number', 'credit card', 'phone', 'id number', 'bank routing number'].includes(entity.entityType.toLowerCase());
    
    if (extracted !== entity.text || (isNumericType && !/\d/.test(extracted))) {
      const correctStart = rawText.indexOf(entity.text);
      if (correctStart !== -1) {
        console.log(`[Layer 0 - INDEX FIX] Corrected hallucinated bounds for "${entity.text}"`);
        return {
          ...entity,
          startIndex: correctStart,
          endIndex: correctStart + entity.text.length
        };
      } else {
        const lowerRaw = rawText.toLowerCase();
        const lowerEntity = entity.text.toLowerCase();
        const correctLowerStart = lowerRaw.indexOf(lowerEntity);
        if (correctLowerStart !== -1) {
          console.log(`[Layer 0 - INDEX FIX] Corrected hallucinated bounds (case-insensitive) for "${entity.text}"`);
          return {
            ...entity,
            startIndex: correctLowerStart,
            endIndex: correctLowerStart + entity.text.length,
            text: rawText.substring(correctLowerStart, correctLowerStart + entity.text.length)
          };
        }
        console.log(`[Layer 0 - INDEX DROP] Dropped entity "${entity.text}" (hallucinated string not found)`);
        return null;
      }
    }
    return entity;
  }).filter(Boolean);
}

// Pure function for Defense Layer 3: Label-Span Validation
function validateEntitySpans(rawText, entities) {
  const suspiciousLabelWords = ["number", "name", "date", "address", "security", "account", "id", "ssn", "phone", "dob"];
  
  return entities.map(entity => {
    let substring = rawText.substring(entity.startIndex, entity.endIndex);
    const nextChars = rawText.substring(entity.endIndex, entity.endIndex + 15);
    
    const isLabelContext = /^\s*([:\-]|is\b|was\b|\n)/i.test(nextChars);
    const endsWithColonOrDash = /[:\-]\s*$/.test(substring);
    const isLabel = isLabelContext || endsWithColonOrDash;
    
    const hasNoDigits = !/\d/.test(substring);
    const lowerSubstring = substring.toLowerCase();
    const hasLabelWord = suspiciousLabelWords.some(word => new RegExp(`\\b${word}\\b`, 'i').test(lowerSubstring));
    
    if (isLabel && hasNoDigits && hasLabelWord) {
      let searchStart = entity.endIndex;
      if (!endsWithColonOrDash) {
         const match = nextChars.match(/^\s*([:\-]|is\b|was\b|\n)/i);
         if (match) searchStart += match[0].length;
      }
      
      const textAfterSeparator = rawText.substring(searchStart, searchStart + 50);
      const valueMatch = textAfterSeparator.match(/^\s*([^\n\r]+)/);
      
      if (valueMatch && valueMatch[1].trim().length > 0) {
        const newValueText = valueMatch[1].trim();
        const matchStartOffset = textAfterSeparator.indexOf(newValueText);
        const newStartIndex = searchStart + matchStartOffset;
        const newEndIndex = newStartIndex + newValueText.length;
        
        console.log(`[Layer 3 - CORRECTION] Shifted label entity "${substring}" to value "${newValueText}"`);
        
        return {
          ...entity,
          text: newValueText,
          startIndex: newStartIndex,
          endIndex: newEndIndex
        };
      } else {
        console.log(`[Layer 3 - DROP] Dropped label entity "${substring}" (no nearby value found)`);
        return null; 
      }
    }
    return entity;
  }).filter(Boolean);
}

function luhnCheck(numString) {
  const arr = numString.replace(/\D/g, '').split('').reverse().map(x => parseInt(x, 10));
  if (arr.length < 13) return false;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    let val = arr[i];
    if (i % 2 !== 0) {
      val *= 2;
      if (val > 9) val -= 9;
    }
    sum += val;
  }
  return sum % 10 === 0;
}

// Pure function for Defense Layer 2: Deterministic Regex Safety Net
function applyRegexSafetyNet(rawText, entities) {
  let correctedEntities = [...entities];
  
  const patterns = [
    { 
      type: 'SSN', 
      regex: /\b\d{3}[-*]?\d{2}[-*]?\d{4}\b/g,
      validate: (matchText, matchIndex, rawText) => {
        // If it's a bare 9-digit string, ensure it's not a routing number by checking context
        if (!matchText.includes('-') && !matchText.includes('*')) {
            const context = rawText.substring(Math.max(0, matchIndex - 40), matchIndex).toLowerCase();
            return context.includes('ssn') || context.includes('social') || context.includes('security');
        }
        return true; // Hyphenated SSNs are always enforced
      }
    },
    { type: 'Credit Card', regex: /\b(?:\d[ -]*?){13,19}\b/g, validate: luhnCheck },
    { 
      type: 'Account Number', 
      regex: /\b\d{8,17}\b/g, 
      validate: (matchText, matchIndex) => {
        const lookbackStart = Math.max(0, matchIndex - 30);
        const context = rawText.substring(lookbackStart, matchIndex).toLowerCase();
        return context.includes('account') || context.includes('acct') || context.includes('routing') || context.includes('direct deposit');
      }
    }
  ];

  patterns.forEach(p => {
    let match;
    while ((match = p.regex.exec(rawText)) !== null) {
      const matchText = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + matchText.length;
      
      if (p.validate && !p.validate(matchText, startIndex, rawText)) continue;
      
      const overlappingEntityIndex = correctedEntities.findIndex(e => e.startIndex <= startIndex && e.endIndex >= endIndex);
      
      if (overlappingEntityIndex !== -1) {
        const e = correctedEntities[overlappingEntityIndex];
        if (e.layer !== 'critical' || e.startIndex !== startIndex || e.endIndex !== endIndex) {
          console.log(`[Layer 2 - OVERRIDE] Correcting entity for ${p.type} to Critical layer and exact bounds.`);
          correctedEntities[overlappingEntityIndex] = {
            ...e,
            layer: 'critical',
            defaultAction: 'redact',
            startIndex,
            endIndex,
            text: matchText,
            reasoning: e.reasoning + " [Corrected by deterministic regex safety net]"
          };
        }
      } else {
        console.log(`[Layer 2 - SYNTHETIC] Injecting missed ${p.type} as Critical.`);
        correctedEntities.push({
          text: matchText,
          startIndex,
          endIndex,
          entityType: p.type,
          layer: 'critical',
          confidenceScore: 100,
          reasoning: "Detected via deterministic pattern match (regex safety net) — automatically classified as Critical regardless of AI confidence, since this entity type is never permitted to go unredacted.",
          defaultAction: 'redact'
        });
      }
    }
  });
  return correctedEntities;
}

// Pure function for Relational Context Coverage (Name/Org fallback)
function checkNameOrgCoverage(rawText, llmEntities) {
  let updatedEntities = [...llmEntities];
  
  const capRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const triggerPhrases = ["worked at", "previously", "joined", "manager", "employed by", "emergency contact", "spouse", "reported to", "supervisor"];
  
  const lines = rawText.split('\n');
  let currentOffset = 0;
  
  for (const line of lines) {
    let match;
    while ((match = capRegex.exec(line)) !== null) {
      const candidateText = match[0];
      const startIndex = currentOffset + match.index;
      const endIndex = startIndex + candidateText.length;
      
      const precedingText = line.substring(Math.max(0, match.index - 5), match.index);
      if (/^$|[\.\!\?]\s*$/.test(precedingText)) {
        continue;
      }
      
      const isCovered = updatedEntities.some(e => 
        (e.startIndex <= startIndex && e.endIndex > startIndex) || 
        (e.startIndex < endIndex && e.endIndex >= endIndex) ||
        (startIndex <= e.startIndex && endIndex >= e.endIndex)
      );
      
      if (!isCovered) {
        const contextStart = Math.max(0, match.index - 50);
        const contextEnd = Math.min(line.length, match.index + candidateText.length + 50);
        const context = line.substring(contextStart, contextEnd).toLowerCase();
        
        const hasTrigger = triggerPhrases.some(phrase => context.includes(phrase));
        
        if (hasTrigger) {
          console.log(`[Layer 2.5 - SYNTHETIC RELATIONAL] Catching missed name/org: "${candidateText}"`);
          updatedEntities.push({
            text: candidateText,
            startIndex,
            endIndex,
            entityType: "name/organization",
            layer: "ambiguous",
            confidenceScore: 100,
            reasoning: "Detected via relational context check — a name or organization near phrasing suggesting personal/employment context, flagged for human review since this wasn't caught by the AI's initial pass.",
            defaultAction: "flag",
            id: crypto.randomUUID()
          });
        }
      }
    }
    currentOffset += line.length + 1; // account for newline
  }
  return updatedEntities;
}

// Pure function to deliberately surface low-confidence criticals for human review
function calibrateEntityLayer(entity) {
  if (entity.layer === 'critical' && entity.confidenceScore < 60) {
    return {
      ...entity,
      layer: 'ambiguous',
      defaultAction: 'flag',
      was_calibrated: true,
      reasoning: entity.reasoning + " Originally classified as Critical (confidence: " + entity.confidenceScore + "%) — automatically flagged for human review per system policy, since high-impact decisions below the confidence threshold default to review rather than silent action."
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

  // Truncate extremely long documents to avoid hitting Groq output token limits
  let inputText = text;
  if (inputText.length > 12000) {
    console.log(`Document text truncated from ${inputText.length} to 12000 chars for LLM analysis.`);
    inputText = inputText.substring(0, 12000);
  }

  const makeRequest = async () => {
    return await groq.chat.completions.create({
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: inputText }
      ],
      model: 'llama-3.1-8b-instant',
      temperature: 0.1,
      max_tokens: 2000,
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
    const chatCompletion = await withTimeout(makeRequest(), 60000);
    return chatCompletion.choices[0].message.content;
  } catch (error) {
    if (error.code === 'timeout') {
      throw error;
    }
    
    // Check if it's a 400 json_validate_failed error (LLM ran out of tokens)
    if (error.status === 400 && error.message && error.message.includes('json_validate_failed')) {
      console.log("Groq returned 400 json_validate_failed — document may be too complex. Retrying...");
      try {
        const retryCompletion = await withTimeout(makeRequest(), 20000);
        return retryCompletion.choices[0].message.content;
      } catch (retryError) {
        const err = new Error("Document is too complex for AI analysis. Try a shorter or simpler document.");
        err.code = "json_validate_failed";
        throw err;
      }
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

async function processDocumentText(text, sourceFilename = null, fileData = null) {
  if (!text || text.trim() === '') {
    throw { status: 400, code: 'empty_document', message: "Document text cannot be empty." };
  }
  if (text.length > 50000) {
    throw { status: 400, code: 'payload_too_large', message: "Document text exceeds the 50,000 character limit." };
  }

  console.log("Analyzing document with Groq LLM...");
  let llmResponse;
  let parsedData;
  let latencyMs = 0;
  
  try {
    const start = Date.now();
    llmResponse = await fetchGroqAnalysis(text);
    latencyMs = Date.now() - start;
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
    require('fs').writeFileSync('groq_error_log.txt', llmError.stack || llmError.message || String(llmError));
    console.error("Groq Engine Error:", llmError.message);
    if (llmError.code === 'timeout') throw { status: 504, code: 'timeout', message: "Analysis is taking longer than expected. Try a shorter document or try again." };
    if (llmError.code === 'rate_limited') throw { status: 429, code: 'rate_limited', message: "Too many requests to the AI engine. Please wait a moment and try again." };
    if (llmError.code === 'json_validate_failed') throw { status: 400, code: 'json_validate_failed', message: llmError.message };
    if (llmError instanceof z.ZodError || llmError instanceof SyntaxError) throw { status: 500, code: 'invalid_schema', message: "LLM Output Schema Validation Failed after retry. The AI returned a malformed format." };
    throw { status: 500, code: 'unknown', message: "Failed to connect to AI Engine or LLM provider." };
  }

  const docId = crypto.randomUUID();
  insertDocument(docId, parsedData.plainTextDocument, sourceFilename, latencyMs, fileData ? fileData.buffer : null, fileData ? fileData.ocrMetadata : null);

  function normalizeEntityType(type) {
    if (!type) return "OTHER";
    const t = type.toUpperCase().trim();
    const validTypes = ["NAME", "EMAIL", "PHONE", "URL", "ORG", "ADDRESS", "ROLE", "SSN", "ACCOUNT_NUMBER", "CARD_NUMBER", "ID_NUMBER", "DATE", "PASSWORD", "OTHER"];
    if (validTypes.includes(t)) return t;
    if (t.includes("MAIL")) return "EMAIL";
    if (t.includes("PHONE") || t.includes("TEL") || t.includes("MOB")) return "PHONE";
    if (t.includes("ORG") || t.includes("COMP") || t.includes("BUSI")) return "ORG";
    if (t.includes("ADDR") || t.includes("LOC")) return "ADDRESS";
    if (t.includes("ROLE") || t.includes("TITLE") || t.includes("JOB")) return "ROLE";
    if (t.includes("SOCIAL") || t.includes("SSN")) return "SSN";
    if (t.includes("ACCT") || t.includes("ACCOUNT")) return "ACCOUNT_NUMBER";
    if (t.includes("CARD") || t.includes("CREDIT")) return "CARD_NUMBER";
    if (t.includes("ID") || t.includes("IDENT")) return "ID_NUMBER";
    if (t.includes("DATE") || t.includes("DOB")) return "DATE";
    if (t.includes("PASS")) return "PASSWORD";
    if (t.includes("NAME") || t.includes("PERSON")) return "NAME";
    if (t.includes("WEB") || t.includes("URL") || t.includes("LINK")) return "URL";
    return "OTHER";
  }

  parsedData.entities = parsedData.entities.map(e => ({
    ...e,
    id: crypto.randomUUID(),
    entityType: normalizeEntityType(e.entityType)
  }));

  // NEW Pipeline Step 0: Fix LLM Index Hallucinations
  parsedData.entities = resolveIndexHallucinations(text, parsedData.entities);

  // NEW Pipeline Step 1: Label-Span Validation
  parsedData.entities = validateEntitySpans(text, parsedData.entities);

  // NEW Pipeline Step 2: Deterministic Regex Safety Net
  parsedData.entities = applyRegexSafetyNet(text, parsedData.entities);

  // NEW Pipeline Step 2.5: Relational Context Name/Org Coverage Check
  parsedData.entities = checkNameOrgCoverage(text, parsedData.entities);

  // EXISTING Pipeline Step 3: Confidence Calibration
  parsedData.entities = parsedData.entities.map(calibrateEntityLayer);

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
    if (!req.file) {
      return res.status(400).json({ error: true, code: 'no_file', message: "No file was uploaded." });
    }
    const isImage = req.file.mimetype === 'image/png' || req.file.mimetype === 'image/jpeg';
    const isPdf = req.file.mimetype === 'application/pdf';

    if (!isPdf && !isImage) {
      return res.status(400).json({ error: true, code: 'invalid_file', message: "Only .pdf, .png, and .jpeg files are supported for this endpoint." });
    }
    
    let cleanText = '';
    let ocrMetadata = null;

    if (isPdf) {
      try {
        const parser = new PDFParse({ data: req.file.buffer });
        const result = await parser.getText();
        cleanText = result.text;
      } catch (e) {
        console.error("PDF text extraction error (pdf-parse):", e.message);
        return res.status(400).json({ error: true, code: 'pdf_parse_error', message: "Failed to extract text from PDF: " + (e.message || "Unknown error") });
      }
    } else if (isImage) {
      try {
        console.log("Running Tesseract OCR on image...");
        const worker = await Tesseract.createWorker('eng');
        const result = await worker.recognize(req.file.buffer, {}, { blocks: true });
        cleanText = result.data.text;
        
        ocrMetadata = [];
        if (result.data.blocks) {
          for (const block of result.data.blocks) {
            if (!block.paragraphs) continue;
            for (const para of block.paragraphs) {
              if (!para.lines) continue;
              for (const line of para.lines) {
                if (!line.words) continue;
                for (const word of line.words) {
                  ocrMetadata.push({
                    text: word.text,
                    bbox: word.bbox
                  });
                }
              }
            }
          }
        }
        await worker.terminate();
      } catch (e) {
        console.error("OCR extraction error:", e);
        return res.status(500).json({ error: true, code: 'ocr_error', message: "Failed to process text from image via OCR." });
      }
    }

    if (!cleanText || cleanText.trim() === '') {
      return res.status(400).json({ error: true, code: 'empty_file', message: "The document appears to be empty or contains no extractable text." });
    }

    const result = await processDocumentText(cleanText, req.file.originalname, { buffer: req.file.buffer, ocrMetadata });
    res.json(result);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: true, code: error.code, message: error.message });
    }
    console.error("Fatal Backend Error:", error);
    res.status(500).json({ error: true, code: 'internal_error', message: "An unexpected internal server error occurred." });
  }
});


// GET /api/documents/:id/audit-trail
app.get('/api/documents/:id/audit-trail', (req, res) => {
  try {
    const docId = req.params.id;
    const { getAuditTrail } = require('./db/index');
    const trail = getAuditTrail(docId);
    res.json(trail);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: true, code: 'internal_error', message: "Failed to retrieve audit trail." });
  }
});

// GET /api/documents/:id/download-original
app.get('/api/documents/:id/download-original', async (req, res) => {
  try {
    const docId = req.params.id;
    const doc = getDocumentWithEntities(docId);
    if (!doc) {
      return res.status(404).json({ error: true, message: "Document not found." });
    }
    if (!doc.original_file) {
      return res.status(404).json({ error: true, message: "Original file not found for this document." });
    }
    let contentType = 'application/pdf';
    if (doc.sourceFilename) {
      const lowerName = doc.sourceFilename.toLowerCase();
      if (lowerName.endsWith('.png')) contentType = 'image/png';
      else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) contentType = 'image/jpeg';
    }
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.sourceFilename || 'original.pdf'}"`);
    return res.end(Buffer.from(doc.original_file));
  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).json({ error: true, message: "Failed to download original file." });
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
    
    if (!['pdf', 'docx', 'txt', 'image'].includes(format)) {
      return res.status(400).json({ error: true, message: "Invalid format." });
    }

    const document = getDocumentWithEntities(docId);
    if (!document) {
      return res.status(404).json({ error: true, message: "Document not found." });
    }

    // Sort entities descending by length to handle overlaps appropriately
    const sortedEntities = [...document.entities].sort((a, b) => {
      const lenA = a.endIndex - a.startIndex;
      const lenB = b.endIndex - b.startIndex;
      return lenB - lenA; 
    });
    
    const text = document.plainTextDocument;
    const charToEntity = new Array(text.length).fill(null);
    for (let entity of sortedEntities) {
      for (let i = entity.startIndex; i < entity.endIndex; i++) {
        if (!charToEntity[i]) {
          charToEntity[i] = entity;
        }
      }
    }
    
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      if (!charToEntity[i]) {
        let textChunk = '';
        while (i < text.length && !charToEntity[i]) {
          textChunk += text[i];
          i++;
        }
        tokens.push({ type: 'text', content: textChunk });
      } else {
        const entity = charToEntity[i];
        const userOverride = overrides && overrides[entity.id] !== undefined ? overrides[entity.id] : null;
        const finalAction = userOverride !== null ? userOverride : entity.defaultAction;
        
        if (finalAction !== 'show') {
           tokens.push({ type: 'pill', content: entity.entityType });
        } else {
           let showChunk = '';
           while (i < text.length && charToEntity[i] === entity) {
             showChunk += text[i];
             i++;
           }
           tokens.push({ type: 'text', content: showChunk });
           continue; 
        }
        
        while (i < text.length && charToEntity[i] === entity) {
          i++;
        }
      }
    }
    
    insertExportLog(crypto.randomUUID(), docId, format);
    const fileExt = format === 'image' ? 'png' : format;
    const filename = `conseal-export-${docId}.${fileExt}`;
    
    if (format === 'txt') {
      let txtContent = '';
      for (const token of tokens) {
        if (token.type === 'text') txtContent += token.content;
        else txtContent += `[${token.content}]`;
      }
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(txtContent);
    }
    
    if (format === 'image') {
      if (!document.original_file || !document.sourceFilename) {
        return res.status(400).json({ error: true, message: "Original file is not an image." });
      }
      
      const { createCanvas, loadImage } = require('canvas');
      const image = await loadImage(document.original_file);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');
      
      // Draw original image
      ctx.drawImage(image, 0, 0, image.width, image.height);
      
      // Extract OCR words for matching
      const ocrWords = document.ocr_metadata ? JSON.parse(document.ocr_metadata) : [];
      
      function normalizeForMatch(str) {
        return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      }

      // Redact entities by drawing black rectangles
      const occurrenceCounts = {};
      
      // Sort entities by their original start index so they appear in document order
      const orderedEntities = [...document.entities].sort((a, b) => a.startIndex - b.startIndex);

      for (const entity of orderedEntities) {
        const userOverride = overrides && overrides[entity.id] !== undefined ? overrides[entity.id] : null;
        const finalDisplayAction = userOverride !== null ? userOverride : entity.defaultAction;
        
        if (finalDisplayAction !== 'redact') {
          continue; 
        }

        const target = normalizeForMatch(entity.text);
        if (!target) continue;

        if (!occurrenceCounts[target]) occurrenceCounts[target] = 0;
        const occurrenceIndex = occurrenceCounts[target]++;

        let matches = [];
        for (let start = 0; start < ocrWords.length; start++) {
          let accumulated = '';
          for (let end = start; end < ocrWords.length; end++) {
            accumulated += normalizeForMatch(ocrWords[end].text);
            if (accumulated.length > target.length) break;
            if (accumulated === target) {
              matches.push({ startItem: start, endItem: end });
              break;
            }
          }
        }

        const match = matches[occurrenceIndex];
        if (match) {
          ctx.fillStyle = '#111111'; // Dark gray/black for redaction
          for (let k = match.startItem; k <= match.endItem; k++) {
            const bbox = ocrWords[k].bbox;
            // Pad the bounding box slightly for full coverage
            const padding = 2;
            ctx.fillRect(
              bbox.x0 - padding, 
              bbox.y0 - padding, 
              bbox.x1 - bbox.x0 + (padding * 2), 
              bbox.y1 - bbox.y0 + (padding * 2)
            );
          }
        }
      }
      
      const buffer = canvas.toBuffer('image/png');
      const ext = document.sourceFilename.toLowerCase().endsWith('.jpg') || document.sourceFilename.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
      res.setHeader('Content-Type', `image/${ext}`);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(buffer);
    }
    
    if (format === 'pdf') {
      if (!document.original_file) {
        return res.status(400).json({ error: true, message: "Original PDF not found in database. Cannot export formatted PDF." });
      }

      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      // Fix: Disable the worker to prevent version collision with pdf-parse's internal pdfjs version
      pdfjsLib.GlobalWorkerOptions.disableWorker = true;
      const fontPath = require('path').resolve(__dirname, 'node_modules/pdfjs-dist/standard_fonts/') + '/';

      async function extractPositionedText(pdfBuffer) {
        const loadingTask = pdfjsLib.getDocument({ 
          data: pdfBuffer,
          standardFontDataUrl: fontPath
        });
        const pdfDocument = await loadingTask.promise;
        const pages = [];

        for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
          const page = await pdfDocument.getPage(pageNum);
          const textContent = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });

          const items = textContent.items.map((item) => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: Math.abs(item.transform[3]) || (item.height ?? 10),
            pageHeight: viewport.height,
          }));

          pages.push({ pageNumber: pageNum - 1, items, pageHeight: viewport.height, pageWidth: viewport.width });
        }
        return pages;
      }

      function normalizeForMatch(str) {
        return str.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
      }

      function findEntityItemRun(entityText, pageItems, occurrenceIndex = 0) {
        const target = normalizeForMatch(entityText);
        if (!target) return null;
        const matches = [];

        for (let start = 0; start < pageItems.length; start++) {
          let accumulated = '';
          for (let end = start; end < pageItems.length; end++) {
            accumulated += normalizeForMatch(pageItems[end].text);
            if (accumulated.length > target.length) break;
            if (accumulated === target) {
              matches.push({ startItem: start, endItem: end });
              break;
            }
          }
        }
        return matches[occurrenceIndex] || matches[0] || null;
      }

      try {
        const isImage = document.sourceFilename && (document.sourceFilename.toLowerCase().endsWith('.png') || document.sourceFilename.toLowerCase().endsWith('.jpg') || document.sourceFilename.toLowerCase().endsWith('.jpeg'));
        
        let extractedPages;
        let pdfDoc;

        if (isImage) {
          pdfDoc = await PDFDocument.create();
          let image;
          if (document.sourceFilename.toLowerCase().endsWith('.png')) {
            image = await pdfDoc.embedPng(document.original_file);
          } else {
            image = await pdfDoc.embedJpg(document.original_file);
          }
          const page = pdfDoc.addPage([image.width, image.height]);
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

          extractedPages = [{
            pageNumber: 0,
            pageWidth: image.width,
            pageHeight: image.height,
            items: (document.ocrMetadata || []).map(w => ({
              text: w.text,
              x: w.bbox.x0,
              y: image.height - w.bbox.y1,
              width: w.bbox.x1 - w.bbox.x0,
              height: w.bbox.y1 - w.bbox.y0
            }))
          }];
        } else {
          extractedPages = await extractPositionedText(document.original_file);
          pdfDoc = await PDFDocument.load(document.original_file);
        }
        
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Group entities by page
        // Wait, entities don't have page numbers explicitly in the Groq response.
        // We have to search for them across all pages.
        // We will maintain a global occurrence counter per normalized text.
        const occurrenceCounts = {};
        
        // Sort entities by startIndex to process them in order of appearance in plain text
        const sortedEntitiesByStart = [...document.entities].sort((a, b) => a.startIndex - b.startIndex);

        for (const entity of sortedEntitiesByStart) {
          const userOverride = overrides && overrides[entity.id] !== undefined ? overrides[entity.id] : null;
          const finalDisplayAction = userOverride !== null ? userOverride : entity.defaultAction;
          
          if (finalDisplayAction !== 'redact') {
            continue; // Draw nothing, leave original text touched
          }

          const target = normalizeForMatch(entity.text);
          if (!target) continue;

          // Increment global occurrence count
          if (!occurrenceCounts[target]) occurrenceCounts[target] = 0;
          const occurrenceIndex = occurrenceCounts[target]++;

          let matchFound = false;
          let pagesSearchedOccurrence = 0;

          // Search across all pages to find the Nth occurrence
          for (const pageData of extractedPages) {
            const pageItems = pageData.items;
            
            // Local search on this page to find how many occurrences of target exist here
            let pageMatches = [];
            for (let start = 0; start < pageItems.length; start++) {
              let accumulated = '';
              for (let end = start; end < pageItems.length; end++) {
                accumulated += normalizeForMatch(pageItems[end].text);
                if (accumulated.length > target.length) break;
                if (accumulated === target) {
                  pageMatches.push({ startItem: start, endItem: end });
                  break; // Move to next start
                }
              }
            }

            if (pageMatches.length > 0) {
              // Does the global occurrenceIndex fall on this page?
              if (occurrenceIndex >= pagesSearchedOccurrence && occurrenceIndex < pagesSearchedOccurrence + pageMatches.length) {
                // We found the page and the match on this page
                const localMatchIndex = occurrenceIndex - pagesSearchedOccurrence;
                const match = pageMatches[localMatchIndex];

                // Group matched items by line (same y within a small tolerance)
                const matchedItems = pageItems.slice(match.startItem, match.endItem + 1);
                const lineGroups = [];
                let currentGroup = [matchedItems[0]];
                
                for (let i = 1; i < matchedItems.length; i++) {
                  const item = matchedItems[i];
                  const lastItem = currentGroup[currentGroup.length - 1];
                  if (Math.abs(item.y - lastItem.y) <= 2) {
                    currentGroup.push(item);
                  } else {
                    lineGroups.push(currentGroup);
                    currentGroup = [item];
                  }
                }
                lineGroups.push(currentGroup);

                const pdfPage = pdfDoc.getPages()[pageData.pageNumber];

                for (const group of lineGroups) {
                  const x = Math.min(...group.map(i => i.x));
                  const y = Math.min(...group.map(i => i.y));
                  const width = Math.max(...group.map(i => i.x + i.width)) - x;
                  const height = Math.max(...group.map(i => i.height));

                  // Adjust y downwards to cover descenders (g, y, p, j, q) which hang below the baseline.
                  // pdfjs-dist transform[5] (our 'y') is the text baseline. 
                  const descenderPadding = height * 0.25; 
                  const boxY = y - descenderPadding;
                  const boxHeight = height * 1.3; // total height to cover ascenders and descenders

                  // Draw on the loaded original page
                  pdfPage.drawRectangle({ x, y: boxY, width, height: boxHeight, color: rgb(0.1, 0.1, 0.1) });
                  
                  const labelWidth = helveticaFont.widthOfTextAtSize(entity.entityType, Math.min(8, height * 0.7));
                  const xPos = width > labelWidth + 8 ? x + (width - labelWidth) / 2 : x + 4;

                  pdfPage.drawText(entity.entityType, {
                    x: xPos,
                    y: boxY + (boxHeight / 2) - (Math.min(8, height * 0.7) / 2.5), // visually centered vertically
                    size: Math.min(8, height * 0.7),
                    font: helveticaFont,
                    color: rgb(1, 1, 1),
                  });
                }
                matchFound = true;
                break; // Move to next entity
              }
              pagesSearchedOccurrence += pageMatches.length;
            }
          }

          if (!matchFound) {
            console.warn(`Warning: Could not find matching text run in PDF for entity ID ${entity.id} ("${entity.text}") at occurrence ${occurrenceIndex}. Skipping visual redaction.`);
          }
        }

        // Security Fix: Strip all interactive annotations (hyperlinks, form fields) from the final redacted PDF
        const { PDFName } = require('pdf-lib');
        pdfDoc.getPages().forEach(page => {
          if (page.node.Annots()) {
            page.node.delete(PDFName.of('Annots'));
          }
        });

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.end(Buffer.from(pdfBytes));

      } catch (err) {
        console.error("PDF generation error:", err);
        return res.status(500).json({ error: true, code: 'export_failed', message: "Failed to generate redacted PDF: " + err.message });
      }
    }
    
    if (format === 'docx') {
      const paragraphs = [];
      let currentParagraphRuns = [];
      
      const flushRun = (content, isPill) => {
        if (isPill) {
           currentParagraphRuns.push(new docx.TextRun({ 
             text: ` ${content} `,
             color: "FFFFFF",
             shading: { type: docx.ShadingType.CLEAR, fill: "333333", color: "333333" },
             bold: true
           }));
        } else {
           currentParagraphRuns.push(new docx.TextRun({ text: content }));
        }
      };

      for (const token of tokens) {
        if (token.type === 'pill') {
          flushRun(token.content, true);
        } else {
          const lines = token.content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) {
              paragraphs.push(new docx.Paragraph({ children: currentParagraphRuns }));
              currentParagraphRuns = [];
            }
            if (lines[i].length > 0) {
              flushRun(lines[i], false);
            }
          }
        }
      }
      if (currentParagraphRuns.length > 0) {
        paragraphs.push(new docx.Paragraph({ children: currentParagraphRuns }));
      }

      const doc = new docx.Document({
        sections: [{ properties: {}, children: paragraphs }]
      });
      const b64string = await docx.Packer.toBase64String(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.end(Buffer.from(b64string, 'base64'));
    }

  } catch (error) {
    console.error("Export Error:", error.message);
    console.error(error.stack);
    
    let errorMessage = "Failed to generate export.";
    if (error.message && error.message.includes("WinAnsi cannot encode")) {
      errorMessage = "PDF Generation Failed: The document contains special characters unsupported by the standard PDF font.";
    } else if (error.message && error.message.includes("widthOfTextAtSize")) {
      errorMessage = "PDF Generation Failed: Could not calculate redaction label width.";
    }

    res.status(500).json({ error: true, message: errorMessage });
  }
});

app.listen(PORT, () => {
  console.log(`Conseal Backend is running on http://localhost:${PORT}`);
  console.log(`Live LLM Integration (Groq) is ACTIVE!`);
  console.log(`Persistent SQLite Database is ACTIVE!`);
});
