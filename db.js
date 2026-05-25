'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'audionote.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Migrations — safe to run on every start
try { db.exec('ALTER TABLE songs ADD COLUMN deleted_at TEXT'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS scan_dirs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    dirpath    TEXT UNIQUE NOT NULL,
    label      TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS songs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    filepath     TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL,
    artist       TEXT DEFAULT '',
    album        TEXT DEFAULT '',
    duration_sec REAL DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS song_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id    INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    note_text  TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timestamps (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id      INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    time_seconds REAL NOT NULL,
    label        TEXT DEFAULT '',
    category     TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
