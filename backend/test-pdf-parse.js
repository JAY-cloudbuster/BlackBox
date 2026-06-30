const fs = require('fs');
const PDFParse = require('pdf-parse');

async function testPdfParse() {
  const dataBuffer = fs.readFileSync('test.pdf');
  const textItems = [];
  
  function render_page(pageData) {
    let render_options = {
      normalizeWhitespace: false,
      disableCombineTextItems: false
    }
    return pageData.getTextContent(render_options).then(function(textContent) {
      // textContent.items contains the text objects
      for (let item of textContent.items) {
        textItems.push({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          dir: item.dir
        });
      }
      return textContent.items.map(item => item.str).join(' ');
    });
  }

  const data = await PDFParse(dataBuffer, { pagerender: render_page });
  console.log('Extracted text preview:', data.text.substring(0, 100));
  console.log('First 3 items:', textItems.slice(0, 3));
}

testPdfParse().catch(console.error);
