const db = require('../db/connection');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      max_attendees INTEGER NOT NULL DEFAULT 50,
      registration_deadline DATETIME,
      status TEXT DEFAULT 'registering',
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_events_start_time ON events(start_time);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      status TEXT DEFAULT 'confirmed',
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(user_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_registrations_event_id ON registrations(event_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_user_id ON registrations(user_id);
    CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);

    CREATE TABLE IF NOT EXISTS waitlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      position INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      promoted_at DATETIME,
      status TEXT DEFAULT 'waiting',
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (event_id) REFERENCES events(id),
      UNIQUE(user_id, event_id)
    );

    CREATE INDEX IF NOT EXISTS idx_waitlists_event_position ON waitlists(event_id, position);
  `);

  console.log('数据库表初始化完成');
}

if (require.main === module) {
  initDatabase();
  process.exit(0);
}

module.exports = initDatabase;
