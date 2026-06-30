const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'conseal.db');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new Database(dbPath);

// Initialize schema idempotently
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

// Idempotent migrations
try { db.exec(`ALTER TABLE documents ADD COLUMN source_filename TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE documents ADD COLUMN analysis_latency_ms INTEGER`); } catch (e) {}
try { db.exec(`ALTER TABLE entities ADD COLUMN was_calibrated BOOLEAN DEFAULT 0`); } catch (e) {}

const statements = {
  insertDoc: db.prepare(`INSERT INTO documents (id, raw_text, source_filename, analysis_latency_ms) VALUES (?, ?, ?, ?)`),
  insertEntity: db.prepare(`
    INSERT INTO entities 
    (id, document_id, text, start_index, end_index, entity_type, layer, confidence_score, reasoning, default_action, was_calibrated) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  insertOverride: db.prepare(`INSERT INTO overrides (id, entity_id, action) VALUES (?, ?, ?)`),
  logExport: db.prepare(`INSERT INTO export_log (id, document_id, format) VALUES (?, ?, ?)`),
  getDoc: db.prepare(`SELECT * FROM documents WHERE id = ?`),
  getEntities: db.prepare(`SELECT * FROM entities WHERE document_id = ? ORDER BY start_index ASC`),
  
  // Uses ROW_NUMBER to get the most recent append-only override per entity
  getLatestOverrides: db.prepare(`
    SELECT entity_id, action FROM (
      SELECT o.entity_id, o.action,
      ROW_NUMBER() OVER (PARTITION BY o.entity_id ORDER BY o.created_at DESC) as rn
      FROM overrides o
      JOIN entities e ON o.entity_id = e.id
      WHERE e.document_id = ?
    ) WHERE rn = 1
  `),
  getAuditTrail: db.prepare(`
    SELECT 
      e.id as entity_id, e.text, e.entity_type, e.layer, e.confidence_score, e.reasoning, e.default_action, e.was_calibrated,
      o.action as override_action, o.created_at as override_timestamp
    FROM overrides o
    JOIN entities e ON o.entity_id = e.id
    WHERE e.document_id = ?
    ORDER BY e.start_index ASC, o.created_at ASC
  `)
};

function insertDocument(id, raw_text, sourceFilename = null, latencyMs = null) {
  statements.insertDoc.run(id, raw_text, sourceFilename, latencyMs);
}

function insertEntities(documentId, entities) {
  const insertMany = db.transaction((ents) => {
    for (const ent of ents) {
      statements.insertEntity.run(
        ent.id, 
        documentId, 
        ent.text, 
        ent.startIndex, 
        ent.endIndex, 
        ent.entityType, 
        ent.layer, 
        ent.confidenceScore, 
        ent.reasoning, 
        ent.defaultAction,
        ent.was_calibrated ? 1 : 0
      );
    }
  });
  insertMany(entities);
}

function insertOverride(id, entity_id, action) {
  statements.insertOverride.run(id, entity_id, action);
}

function insertExportLog(id, document_id, format) {
  statements.logExport.run(id, document_id, format);
}

function getDocumentWithEntities(documentId) {
  const doc = statements.getDoc.get(documentId);
  if (!doc) return null;
  const entities = statements.getEntities.all(documentId);
  return {
    ...doc,
    plainTextDocument: doc.raw_text,
    sourceFilename: doc.source_filename,
    analysisLatencyMs: doc.analysis_latency_ms,
    entities: entities.map(e => ({
      id: e.id,
      text: e.text,
      startIndex: e.start_index,
      endIndex: e.end_index,
      entityType: e.entity_type,
      layer: e.layer,
      confidenceScore: e.confidence_score,
      reasoning: e.reasoning,
      defaultAction: e.default_action,
      was_calibrated: e.was_calibrated === 1
    }))
  };
}

function getLatestOverrides(documentId) {
  // Returns a map/object of { entity_id: action }
  const rows = statements.getLatestOverrides.all(documentId);
  const overridesMap = {};
  for (const row of rows) {
    if (row.action !== 'reset') {
      overridesMap[row.entity_id] = row.action;
    }
  }
  return overridesMap;
}

function getAuditTrail(documentId) {
  return statements.getAuditTrail.all(documentId);
}

module.exports = {
  db,
  insertDocument,
  insertEntities,
  insertOverride,
  insertExportLog,
  getDocumentWithEntities,
  getLatestOverrides,
  getAuditTrail
};
