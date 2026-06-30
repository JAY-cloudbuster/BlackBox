const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else if (f.endsWith('.css') || f.endsWith('.jsx')) {
      callback(path.join(dir, f));
    }
  });
}

walkDir('frontend/src', file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  // Replace CSS border-radius
  content = content.replace(/border-radius:\s*(?!50%)[^;]+;/g, 'border-radius: 0;');
  
  // Replace JSX borderRadius
  content = content.replace(/borderRadius:\s*['"]?(?!50%)[^,'"}]+['"]?/g, 'borderRadius: 0');
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log('Updated ' + file);
  }
});
