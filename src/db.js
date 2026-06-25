import Database from 'better-sqlite3';
import path from 'path';
import { CONFIG_DIR, initConfigDirs } from './config.js';

const DB_PATH = path.join(CONFIG_DIR, 'history.db');
let db = null;

export function initDatabase() {
  if (db) return db;

  initConfigDirs();
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tool_name TEXT,
      arguments TEXT,
      status TEXT CHECK(status IN ('pending', 'approved', 'rejected', 'success', 'failed')),
      output TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  return db;
}

export function createSession(sessionId, name = 'New Chat') {
  const connection = initDatabase();
  const stmt = connection.prepare('INSERT OR IGNORE INTO sessions (id, name) VALUES (?, ?)');
  stmt.run(sessionId, name);
}

export function saveMessage(sessionId, role, content) {
  const connection = initDatabase();
  const stmt = connection.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)');
  const serializedContent = typeof content === 'object' ? JSON.stringify(content) : String(content || '');
  stmt.run(sessionId || '', role || '', serializedContent);
  
  // Update the session's updated_at timestamp
  const updateStmt = connection.prepare('UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  updateStmt.run(sessionId || '');
}

export function getLastSession() {
  const connection = initDatabase();
  const stmt = connection.prepare('SELECT id, name FROM sessions ORDER BY updated_at DESC LIMIT 1');
  return stmt.get();
}

export function getSessionMessages(sessionId) {
  const connection = initDatabase();
  const stmt = connection.prepare('SELECT role, content, timestamp FROM messages WHERE session_id = ? ORDER BY id ASC');
  return stmt.all(sessionId || '');
}

export function logToolRun(sessionId, toolName, args, status, output = '') {
  const connection = initDatabase();
  const stmt = connection.prepare(`
    INSERT INTO tool_runs (session_id, tool_name, arguments, status, output)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    sessionId || '',
    toolName || '',
    args ? JSON.stringify(args) : '{}',
    status || '',
    output !== undefined && output !== null ? String(output) : ''
  );
  return info.lastInsertRowid;
}

export function updateToolRun(id, status, output) {
  const connection = initDatabase();
  const stmt = connection.prepare('UPDATE tool_runs SET status = ?, output = ? WHERE id = ?');
  stmt.run(status || '', output !== undefined && output !== null ? String(output) : '', id);
}
