const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { dbPath } = require('../config');

const dbDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(path.resolve(dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
