# Conseal: Project Writeup

## What We Built

**Conseal** is a lightning-fast, full-stack document sanitization platform designed to detect and redact Personally Identifiable Information (PII) with high accuracy and explainability. Traditional redaction tools rely on rigid Regular Expressions (RegEx), which fail to capture contextual PII and often lead to dangerous data leaks. 

To solve this, we built a system powered by LLM inference (using Groq for ultra-low latency). Our solution:
- **Accepts Multiple Formats:** Users can input raw text, multi-page PDFs, or images (.png, .jpg).
- **Employs Intelligent Extraction:** It parses the document, passes it through an AI engine that identifies PII (names, emails, financial details, contextual identifiers) with high precision, and categorizes them with an explainable "AI Layer".
- **Features an Explainability Engine:** We built a gorgeous, interactive React frontend where users can review *why* the AI flagged certain text. It includes a bulk-edit checklist to rapidly toggle redactions on or off, keeping humans firmly in the loop.
- **Performs Native Exports:** Instead of just blacking out HTML elements, our Node.js backend uses `pdfjs-dist` and `canvas` to physically draw opaque black boxes over the exact coordinates in the original binary files, ensuring the PII is truly shredded from the exported document.

## What We Intentionally Chose Not to Build

To maintain a laser focus on the core user experience and the hackathon timeline, we intentionally excluded the following features:

1. **Persistent Database Storage:**
   We chose *not* to build a database or user-authentication system (like PostgreSQL or Firebase). Because we are handling highly sensitive PII, storing user documents introduces immense security overhead. By keeping the application entirely ephemeral—processing documents in-memory and discarding them immediately—we prioritized user privacy and simplified our architecture.

2. **Optical Character Recognition (OCR) for Scanned PDFs:**
   While we support native images and text-selectable PDFs, we opted out of implementing a heavy OCR engine (like Tesseract) for scanned, non-selectable PDFs. Integrating OCR would have significantly inflated the backend payload size and processing times, compromising the lightning-fast UX we aimed for with Groq.

3. **Complex Enterprise RBAC (Role-Based Access Control):**
   We did not implement multi-tier approval workflows (e.g., an "Editor" redacts, and a "Manager" approves). We focused purely on the single-user experience to ensure the Explainability Engine and native redaction mechanics were perfectly polished, rather than spreading our efforts thin across enterprise management features.
