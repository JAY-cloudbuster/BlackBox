const fs = require('fs');
const PDFParser = require("pdf2json");

async function parsePDF(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
    pdfParser.on("pdfParser_dataReady", pdfData => {
      let rawText = "";
      const textMap = []; // Maps character index in rawText to PDF text element {page, x, y, w, h}
      
      let pageNum = 1;
      for (const page of pdfData.Pages) {
        for (const txt of page.Texts) {
          const str = decodeURIComponent(txt.R[0].T);
          const startIndex = rawText.length;
          rawText += str + " "; // Add space after each block
          
          textMap.push({
            startIndex,
            endIndex: rawText.length - 1, // Exclude the added space
            str,
            page: pageNum,
            x: txt.x,
            y: txt.y,
            w: txt.w,
            h: txt.R[0].TS[1] // Font size proxy
          });
        }
        rawText += "\n"; // Newline after page
        pageNum++;
      }
      
      resolve({ rawText, textMap });
    });
    pdfParser.parseBuffer(buffer);
  });
}

(async () => {
  const buffer = fs.readFileSync('test.pdf');
  const res = await parsePDF(buffer);
  console.log("Raw Text Length:", res.rawText.length);
  console.log("First mapping:", res.textMap[0]);
  
  // Find a word
  const match = res.rawText.indexOf("Rachel");
  if (match !== -1) {
    const item = res.textMap.find(t => match >= t.startIndex && match <= t.endIndex);
    console.log("Found Rachel at:", item);
  }
})();
