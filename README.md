<div align="center">
  
# 🛡️ Conseal: Intelligent Document Anonymization

[![React](https://img.shields.io/badge/React-18.x-blue?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green?style=for-the-badge&logo=nodedotjs)](https://nodejs.org/)
[![Groq](https://img.shields.io/badge/Powered_by-Groq-f59e0b?style=for-the-badge)](https://groq.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**Conseal** is a lightning-fast, AI-powered document sanitization platform that automatically detects and redacts Personally Identifiable Information (PII) from PDFs, Images, and Text files while providing a transparent Explainability Engine for human review.

[**Live Demo**](https://black-box-dun-iota.vercel.app/) • [**Demo Video**](https://drive.google.com/drive/folders/1y5NW5UF9F6obAtN2ajwyCdkDuIyFRE0A?usp=sharing) • [**Project Writeup**](./WRITEUP.md) • [**GitHub Repository**](INSERT_GITHUB_LINK_HERE)

</div>

---

## 🏆 Hackathon Submission Materials

Judges, welcome to the Conseal repository! You can find all required submission materials linked below for easy access:

- **🔗 Public GitHub Repository:** [View on GitHub](INSERT_GITHUB_LINK_HERE)
- **🚀 Live Deployment:** [Frontend (Vercel) & Backend (Render)](https://black-box-dun-iota.vercel.app/)
- **🎥 Demo Video:** [Watch the Experience in Action](https://drive.google.com/drive/folders/1y5NW5UF9F6obAtN2ajwyCdkDuIyFRE0A?usp=sharing)
  - *If the link above doesn't click, copy and paste this URL:* `https://drive.google.com/drive/folders/1y5NW5UF9F6obAtN2ajwyCdkDuIyFRE0A?usp=sharing`
- **📝 Project Writeup:** [Read the ~Half-Page Writeup](./WRITEUP.md) (Details on what we built vs. what we excluded)
- **💻 Runnable Source Code:** Setup instructions provided below.

---

## ✨ Features

- **Multi-Format Support:** Instantly process raw text, multi-page PDFs, and images (PNG/JPG).
- **Intelligent PII Detection:** Powered by advanced LLM inference (via Groq) to catch names, emails, financial data, and contextual PII that regex completely misses.
- **Explainability Engine:** A beautiful side-panel UI that allows humans-in-the-loop to review *why* the AI flagged a specific word, complete with a bulk-edit checklist.
- **Native Redactions:** Exports true redactions. For PDFs, it draws black boxes over the exact coordinates of the PII. For images, it renders redaction pixels natively onto a canvas.
- **Dark/Light Mode:** A gorgeous, glassmorphism UI tailored for comfortable, extended document review.

## 🛠️ Tech Stack

- **Frontend:** React (Vite), Vanilla CSS (Custom Design System), PDF.js for rendering
- **Backend:** Node.js, Express, `pdfjs-dist` & `canvas` for native binary document manipulation
- **AI/Inference:** Groq API for sub-second, highly-accurate PII entity extraction

---

## 🚀 Local Setup Instructions

To run Conseal locally on your machine, you'll need Node.js installed.

### 1. Clone the Repository
```bash
git clone INSERT_GITHUB_LINK_HERE
cd BlackBox
```

### 2. Backend Setup
```bash
cd backend
npm install
```
Create a `.env` file in the `backend/` directory and add your Groq API key:
```env
GROQ_API_KEY=your_groq_api_key_here
PORT=5000
```
Start the backend server:
```bash
npm run dev
```

### 3. Frontend Setup
Open a new terminal window:
```bash
cd frontend
npm install
npm run dev
```

The application will be running at `http://localhost:5173`. 

---

## 🔒 Security First
All document processing happens ephemerally. Documents are loaded into memory, parsed, and immediately discarded after export. No files are stored permanently on the server.

<div align="center">
  <i>Built with ❤️ for the Hackathon</i>
</div>
