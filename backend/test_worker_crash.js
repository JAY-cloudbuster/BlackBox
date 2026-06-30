const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function run() {
  const buf = fs.readFileSync('test.pdf');
  
  // 1. UPLOAD 1
  const parser1 = new PDFParse({ data: buf });
  await parser1.getText();
  
  // Clean globals
  delete globalThis.pdfjsWorker;
  delete global.pdfjsWorker;
  delete globalThis.WorkerMessageHandler;
  delete global.WorkerMessageHandler;

  // 2. EXPORT 1
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.disableWorker = true;
  await pdfjsLib.getDocument({ data: buf }).promise;
  console.log("Export 1 success");

  // 3. UPLOAD 2
  const parser2 = new PDFParse({ data: buf });
  await parser2.getText();

  // Clean globals again
  delete globalThis.pdfjsWorker;
  delete global.pdfjsWorker;
  delete globalThis.WorkerMessageHandler;
  delete global.WorkerMessageHandler;

  // 4. EXPORT 2
  await pdfjsLib.getDocument({ data: buf }).promise;
  console.log("Export 2 success");
}
run();
