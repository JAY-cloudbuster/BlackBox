require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const { z } = require('zod');
const crypto = require('crypto');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const docx = require('docx');

const { db, insertDocument, insertEntities, insertOverride, insertExportLog, getDocumentWithEntities, getLatestOverrides } = require('./db/index');

const app = express();
const PORT = 3000;

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
  insertDocument(docId, parsedData.plainTextDocument, sourceFilename, latencyMs);

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
    if (!req.file || req.file.mimetype !== 'application/pdf') {
      return res.status(400).json({ error: true, code: 'invalid_file', message: "Only .pdf files are supported for this endpoint." });
    }
    
    let text;
    try {
      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      text = result.text;
    } catch (e) {
      console.error("PDF Parse Error:", e);
      return res.status(400).json({ error: true, code: 'pdf_parse_error', message: "Failed to parse PDF file: " + (e.message || "Unknown error") });
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
