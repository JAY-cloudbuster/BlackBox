const fs = require('fs');
const PDFParser = require("pdf2json");

const pdfParser = new PDFParser();

pdfParser.on("pdfParser_dataError", errData => console.error(errData.parserError));
pdfParser.on("pdfParser_dataReady", pdfData => {
  fs.writeFileSync('test-pdf.json', JSON.stringify(pdfData));
  console.log("Extracted to test-pdf.json");
});

pdfParser.loadPDF("test.pdf");
