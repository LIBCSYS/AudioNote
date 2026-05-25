'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');

const app        = express();
const PORT       = 3005;
const MUSIC_ROOT = path.join(__dirname, '..');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function scanDir(dir, results = []) {
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }
  for (const item of items) {
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (full !== __dirname) scanDir(full, results);
    } else if (item.isFile() && item.name.toLowerCase().endsWith('.mp3')) {
      results.push(full);
    }
  }
  return results;
}

// List available drives (C: through Z:, checks existence)
app.get('/api/drives', (req, res) => {
  const drives = [];
  for (let i = 67; i <= 90; i++) {
    const drive = String.fromCharCode(i) + ':\\';
    if (fs.existsSync(drive)) drives.push(drive);
  }
  res.json(drives);
});

// ── SCAN DIRECTORIES ──────────────────────────────────────

app.get('/api/scan-dirs', (req, res) => {
  res.json(db.prepare('SELECT * FROM scan_dirs ORDER BY created_at').all());
});

app.post('/api/scan-dirs', (req, res) => {
  const { dirpath, label } = req.body;
  if (!dirpath) return res.status(400).json({ error: 'dirpath required' });
  if (!fs.existsSync(dirpath)) return res.status(400).json({ error: 'Directory not found' });
  try {
    const result = db.prepare('INSERT INTO scan_dirs (dirpath, label) VALUES (?, ?)').run(dirpath.trim(), label || '');
    res.json(db.prepare('SELECT * FROM scan_dirs WHERE id = ?').get(result.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Directory already added' });
  }
});

app.delete('/api/scan-dirs/:id', (req, res) => {
  db.prepare('DELETE FROM scan_dirs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Rescan all configured directories (falls back to parent dir if none configured)
app.post('/api/rescan', async (req, res) => {
  const mm = require('music-metadata');
  const configuredDirs = db.prepare('SELECT dirpath FROM scan_dirs').all().map(r => r.dirpath);
  const dirsToScan = configuredDirs.length ? configuredDirs : [MUSIC_ROOT];
  const files = [];
  for (const dir of dirsToScan) scanDir(dir, files);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO songs (filepath, title, artist, album, duration_sec) VALUES (?, ?, ?, ?, ?)'
  );
  let added = 0;
  for (const fp of files) {
    const exists = db.prepare('SELECT id FROM songs WHERE filepath = ?').get(fp);
    if (!exists) {
      let title = path.basename(fp, '.mp3');
      let artist = '', album = '', duration_sec = 0;
      try {
        const meta = await mm.parseFile(fp, { duration: true, skipCovers: true });
        title        = meta.common.title  || title;
        artist       = meta.common.artist || '';
        album        = meta.common.album  || '';
        duration_sec = meta.format.duration || 0;
      } catch {}
      insert.run(fp, title, artist, album, duration_sec);
      added++;
    }
  }
  // Remove DB entries whose files no longer exist
  const allSongs = db.prepare('SELECT id, filepath FROM songs').all();
  const removed = allSongs.filter(s => !fs.existsSync(s.filepath));
  const deleteSong = db.prepare('DELETE FROM songs WHERE id = ?');
  for (const s of removed) deleteSong.run(s.id);

  const songs = db.prepare(SONGS_QUERY).all();
  res.json({ added, removed: removed.length, total: songs.length, songs });
});

const SONGS_QUERY = `
  SELECT s.*,
    CASE WHEN sn.note_text IS NOT NULL AND sn.note_text != '' THEN 1 ELSE 0 END AS has_note
  FROM songs s
  LEFT JOIN song_notes sn ON sn.song_id = s.id
  ORDER BY s.artist, s.title
`;

app.get('/api/songs', (req, res) => {
  res.json(db.prepare(SONGS_QUERY).all());
});

app.get('/api/songs/:id/notes', (req, res) => {
  const note = db.prepare('SELECT * FROM song_notes WHERE song_id = ?').get(req.params.id);
  res.json(note || { note_text: '' });
});

app.post('/api/songs/:id/notes', (req, res) => {
  const { note_text } = req.body;
  const exists = db.prepare('SELECT id FROM song_notes WHERE song_id = ?').get(req.params.id);
  if (exists) {
    db.prepare('UPDATE song_notes SET note_text = ?, updated_at = datetime("now") WHERE song_id = ?')
      .run(note_text, req.params.id);
  } else {
    db.prepare('INSERT INTO song_notes (song_id, note_text) VALUES (?, ?)').run(req.params.id, note_text);
  }
  res.json({ ok: true });
});

app.get('/api/songs/:id/timestamps', (req, res) => {
  res.json(db.prepare('SELECT * FROM timestamps WHERE song_id = ? ORDER BY time_seconds').all(req.params.id));
});

app.post('/api/songs/:id/timestamps', (req, res) => {
  const { time_seconds, label = '', category = '' } = req.body;
  const result = db.prepare(
    'INSERT INTO timestamps (song_id, time_seconds, label, category) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, time_seconds, label, category);
  res.json(db.prepare('SELECT * FROM timestamps WHERE id = ?').get(result.lastInsertRowid));
});

app.patch('/api/timestamps/:id', (req, res) => {
  const { label = '', category = '' } = req.body;
  db.prepare('UPDATE timestamps SET label = ?, category = ? WHERE id = ?').run(label, category, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/timestamps/:id', (req, res) => {
  db.prepare('DELETE FROM timestamps WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Stream audio with range support (required for seeking)
app.get('/audio/:id', (req, res) => {
  const song = db.prepare('SELECT filepath FROM songs WHERE id = ?').get(req.params.id);
  if (!song || !fs.existsSync(song.filepath)) return res.status(404).send('Not found');

  const stat     = fs.statSync(song.filepath);
  const fileSize = stat.size;
  const range    = req.headers.range;

  if (range) {
    const [s, e]  = range.replace(/bytes=/, '').split('-');
    const start   = parseInt(s, 10);
    const end     = e ? parseInt(e, 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': end - start + 1,
      'Content-Type':   'audio/mpeg',
    });
    fs.createReadStream(song.filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   'audio/mpeg',
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(song.filepath).pipe(res);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nAudioNote v1.0`);
  console.log(`Listening : http://0.0.0.0:${PORT}`);
  console.log(`Music root: ${MUSIC_ROOT}`);
  console.log(`Network   : http://100.111.177.18:${PORT}\n`);
});
