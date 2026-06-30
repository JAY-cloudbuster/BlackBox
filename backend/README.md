# Conseal Backend

This is the backend server for the Conseal application.

## Prerequisites

- Node.js (v18 or higher recommended)
- **Python 3.8+** (Required for PDF physical redaction)

## Setup

1. Install Node dependencies:
```bash
npm install
```

2. Install Python dependencies (required for PyMuPDF):
```bash
pip install pymupdf
# or if using a system-managed python environment:
pip install pymupdf --break-system-packages
```

## Running the Server

```bash
npm run dev
```

## Architectural Notes

**PDF Redaction Exception**: This project generally avoids new major dependencies outside the JS ecosystem. However, due to the immaturity of native Node PDF manipulation libraries (e.g., `mupdf` npm package throwing WASM errors on annotation creation and lacking overlay support, and `pdf-lib` not supporting true physical redaction of underlying text paths), we use a minimal Python subprocess (`redact_pdf.py`) powered by `PyMuPDF`. This is the only safe and robust way to achieve true, non-reversible physical redaction with custom labels.
