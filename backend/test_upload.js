const fs = require('fs');

async function test() {
  const fileBuffer = fs.readFileSync('C:\\Users\\kjaye\\Downloads\\Kaushal_Resume.pdf');
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), 'Kaushal_Resume.pdf');
  
  try {
    const res = await fetch('http://localhost:3000/api/documents/upload', {
      method: 'POST',
      body: formData
    });
    const text = await res.text();
    console.log(res.status, text);
  } catch(e) {
    console.error('Fetch error:', e.message);
  }
}
test();
