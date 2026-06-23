const db = require('../db/connection');

function runMigrations() {
  const columns = db
    .prepare("PRAGMA table_info(registrations)")
    .all()
    .map(col => col.name);

  if (!columns.includes('checked_in_at')) {
    db.exec("ALTER TABLE registrations ADD COLUMN checked_in_at DATETIME");
    console.log('[Migration] registrations 表已新增 checked_in_at 字段');
  }

  console.log('[Migration] 数据库迁移完成');
}

if (require.main === module) {
  runMigrations();
  process.exit(0);
}

module.exports = runMigrations;
