const fs = require('fs');
const PDFParser = require("pdf2json");
const { PDFDocument } = require('pdf-lib');

(async () => {
  const buffer = fs.readFileSync('test.pdf');
  
  // pdf-lib
  const pdfDoc = await PDFDocument.load(buffer);
  const page = pdfDoc.getPages()[0];
  const { width, height } = page.getSize();
  console.log('pdf-lib dimensions (points):', width, 'x', height);
  
  // pdf2json
  const pdfParser = new PDFParser();
  pdfParser.on("pdfParser_dataReady", pdfData => {
    const p1 = pdfData.Pages[0];
    console.log('pdf2json page width (Width):', p1.Width); // Usually Width is in custom units?
    // Conversion factor?
    console.log('Width Conversion factor:', width / p1.Width);
  });
  pdfParser.parseBuffer(buffer);
})();
