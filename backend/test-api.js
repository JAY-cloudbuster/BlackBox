const fs = require('fs');
const FormData = require('form-data');

async function uploadPDF() {
  const form = new FormData();
  form.append('file', fs.createReadStream('test.pdf'));

  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: form
    });
    const data = await response.json();
    console.log("Upload Success:", !!data.documentId);
    console.log("Entities count:", data.entities ? data.entities.length : 0);
    if (data.entities && data.entities.length > 0) {
      console.log("First entity bounding boxes:", data.entities[0].boundingBoxes);
    }
    
    // Then export
    if (data.documentId) {
      const exportRes = await fetch(`http://localhost:3000/api/documents/${data.documentId}/export?format=pdf`, {
        method: 'POST'
      });
      if (exportRes.ok) {
         const pdfBuffer = await exportRes.arrayBuffer();
         fs.writeFileSync(`exported-${data.documentId}.pdf`, Buffer.from(pdfBuffer));
         console.log("Exported successfully to exported-" + data.documentId + ".pdf");
      } else {
         console.error("Export failed:", await exportRes.text());
      }
    }
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

uploadPDF();
