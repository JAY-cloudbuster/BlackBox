const { db, getDocumentWithEntities } = require('./db/index');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const docId = 'eb5538f6-eaee-4477-b04e-679ed5a62579';

async function testExport() {
  try {
    const document = getDocumentWithEntities(docId);
    if (!document) {
      console.log("Doc not found");
      return;
    }
    const overridesRows = db.prepare('SELECT entity_id, action FROM overrides WHERE entity_id IN (SELECT id FROM entities WHERE document_id = ?) ORDER BY created_at DESC').all(docId);
    const overrides = {};
    for (const row of overridesRows) {
      if (!overrides[row.entity_id]) overrides[row.entity_id] = row.action;
    }
    const sortedEntities = [...document.entities].sort((a, b) => {
      const lenA = a.endIndex - a.startIndex;
      const lenB = b.endIndex - b.startIndex;
      return lenB - lenA; 
    });
    
    const text = document.plainTextDocument;
    const charToEntity = new Array(text.length).fill(null);
    for (let entity of sortedEntities) {
      for (let i = entity.startIndex; i < entity.endIndex; i++) {
        if (!charToEntity[i]) {
          charToEntity[i] = entity;
        }
      }
    }
    
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      if (!charToEntity[i]) {
        let textChunk = '';
        while (i < text.length && !charToEntity[i]) {
          textChunk += text[i];
          i++;
        }
        tokens.push({ type: 'text', content: textChunk });
      } else {
        const entity = charToEntity[i];
        const userOverride = overrides && overrides[entity.id] !== undefined ? overrides[entity.id] : null;
        const finalAction = userOverride !== null ? userOverride : entity.defaultAction;
        
        if (finalAction !== 'show') {
           tokens.push({ type: 'pill', content: entity.entityType });
        } else {
           let showChunk = '';
           while (i < text.length && charToEntity[i] === entity) {
             showChunk += text[i];
             i++;
           }
           tokens.push({ type: 'text', content: showChunk });
           continue; 
        }
        
        while (i < text.length && charToEntity[i] === entity) {
          i++;
        }
      }
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 11;
    const margin = 50;
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    
    let y = height - margin;
    let x = margin;
    
    const elements = [];
    for (const token of tokens) {
      if (token.type === 'pill') {
        elements.push(token);
      } else {
        const lines = token.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i > 0) elements.push({ type: 'newline' });
          
          const words = lines[i].split(/(\s+)/);
          for (const word of words) {
             if (word.length > 0) elements.push({ type: 'text', content: word });
          }
        }
      }
    }

    const pillPadding = 4;
    
    const sanitizeWinAnsi = (str) => {
      if (!str) return '';
      return str
        .replace(/[\r\t]/g, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/[—–]/g, "-")
        .replace(/[^\x00-\xFF]/g, '');
    };
    
    for (const el of elements) {
      if (el.type === 'newline') {
        x = margin;
        y -= (fontSize + 6);
        if (y < margin) {
          page = pdfDoc.addPage();
          y = height - margin;
        }
        continue;
      }
      
      let elWidth = 0;
      let isSpace = false;
      if (el.type === 'pill') {
        el.content = sanitizeWinAnsi(el.content);
        elWidth = font.widthOfTextAtSize(el.content, fontSize - 1) + (pillPadding * 2);
      } else {
        el.content = sanitizeWinAnsi(el.content);
        elWidth = font.widthOfTextAtSize(el.content, fontSize);
        isSpace = /^[\s]+$/.test(el.content);
      }
      
      if (x + elWidth > width - margin && x > margin && !isSpace) {
        x = margin;
        y -= (fontSize + 6);
        if (y < margin) {
          page = pdfDoc.addPage();
          y = height - margin;
        }
      }
      
      if (el.type === 'pill') {
        page.drawRectangle({
          x: x,
          y: y - 2,
          width: elWidth,
          height: fontSize + 4,
          color: rgb(0.2, 0.2, 0.2)
        });
        page.drawText(el.content, {
          x: x + pillPadding,
          y: y,
          size: fontSize - 1,
          font: font,
          color: rgb(1, 1, 1)
        });
        x += elWidth;
      } else {
        page.drawText(el.content, {
          x: x,
          y: y,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0)
        });
        x += elWidth;
      }
    }
    
    await pdfDoc.save();
    console.log("PDF OK");
  } catch(e) {
    console.error("PDF FAILED:", e.message);
    console.error(e.stack);
  }
}

testExport();
