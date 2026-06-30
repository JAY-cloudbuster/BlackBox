const fs = require('fs');
const http = require('http');

// Simple base64 PNG
const imgBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
const buffer = Buffer.from(imgBase64, 'base64');
fs.writeFileSync('test.png', buffer);

const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
const CRLF = '\r\n';
let postData = '--' + boundary + CRLF;
postData += 'Content-Disposition: form-data; name="file"; filename="test.png"' + CRLF;
postData += 'Content-Type: image/png' + CRLF + CRLF;

const postDataBuffer = Buffer.concat([
  Buffer.from(postData),
  buffer,
  Buffer.from(CRLF + '--' + boundary + '--' + CRLF)
]);

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/documents/upload',
  method: 'POST',
  headers: {
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
    'Content-Length': postDataBuffer.length
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});
req.on('error', (e) => console.error(e));
req.write(postDataBuffer);
req.end();
