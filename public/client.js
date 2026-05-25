'use strict';

const state = { songs: [], currentSong: null, timestamps: [], notedOnly: false };
const WEB_MODE    = !!window.WEB_MODE;
const fileHandles = new Map(); // WEB_MODE: songId -> File

const $ = id => document.getElementById(id);

const audio       = $('audio');
const playBtn     = $('play-btn');
const progressBar = $('progress');
const tCurrent    = $('t-current');
const tTotal      = $('t-total');
const volumeBar   = $('volume');
const markBtn     = $('mark-btn');
const noteInput   = $('note-input');
const noteStatus  = $('note-status');
const tsList      = $('ts-list');
const tsCount     = $('ts-count');
const songList    = $('song-list');
const searchInput = $('search-input');
const songCount   = $('song-count');
const playerPanel = $('player-panel');
const emptyState  = $('empty-state');
const rescanBtn   = $('rescan-btn');
const notedFilter = $('noted-filter');
const renameBtn   = $('rename-btn');
const deleteBtn   = $('delete-btn');
const scanPanel   = $('scan-panel');
const foldersList = $('folders-list');
const drivesList  = $('drives-list');
const folderInput = $('folder-input');
const folderAddBtn = $('folder-add-btn');
const folderError  = $('folder-error');
const scanNowBtn   = $('scan-now-btn');

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── SONG LIST ──────────────────────────────────────────────

async function loadSongs() {
  if (WEB_MODE) return; // web mode populates via folder picker
  const res = await fetch('/api/songs');
  state.songs = await res.json();
  applyFilters();
}

function visibleSongs() {
  return state.notedOnly ? state.songs.filter(s => s.has_note) : state.songs;
}

function renderSongList(songs) {
  songCount.textContent = `${songs.length} track${songs.length !== 1 ? 's' : ''}`;
  songList.innerHTML = '';
  if (!songs.length) {
    const msg = state.notedOnly ? 'No noted tracks yet' : (WEB_MODE ? 'Click Choose Folder to load your MP3s' : 'No tracks found — click Rescan Library');
    songList.innerHTML = `<li class="muted" style="padding:12px 16px;font-style:italic">${msg}</li>`;
    return;
  }
  for (const s of songs) {
    const li = document.createElement('li');
    if (state.currentSong?.id === s.id) li.classList.add('active');
    li.dataset.id = s.id;
    const meta = [s.artist, s.album].filter(Boolean).join(' · ');
    const dur  = s.duration_sec ? `<span class="song-duration">${fmt(s.duration_sec)}</span>` : '';
    li.innerHTML = `
      <div class="song-item-title">${esc(s.title)}${s.has_note ? '<span class="note-flag">📝</span>' : ''}</div>
      <div class="song-item-meta">${esc(meta)}${dur}</div>
    `;
    li.addEventListener('click', () => selectSong(s));
    songList.appendChild(li);
  }
}

// ── SELECT SONG ────────────────────────────────────────────

async function selectSong(song) {
  state.currentSong = song;

  document.querySelectorAll('#song-list li').forEach(li =>
    li.classList.toggle('active', parseInt(li.dataset.id) === song.id)
  );

  $('np-title').textContent = song.title;
  $('np-meta').textContent  = [song.artist, song.album].filter(Boolean).join(' · ') || 'Unknown';

  if (WEB_MODE) {
    const file = fileHandles.get(song.id);
    if (audio.src && audio.src.startsWith('blob:')) URL.revokeObjectURL(audio.src);
    audio.src = file ? URL.createObjectURL(file) : '';
  } else {
    audio.src = `/audio/${song.id}`;
  }
  audio.load();
  progressBar.value   = 0;
  tCurrent.textContent = '0:00';
  tTotal.textContent   = fmt(song.duration_sec);
  playBtn.textContent  = '▶';

  playerPanel.classList.remove('hidden');
  emptyState.classList.add('hidden');

  const [noteRes, tsRes] = await Promise.all([
    fetch(`/api/songs/${song.id}/notes`),
    fetch(`/api/songs/${song.id}/timestamps`),
  ]);
  const noteData = await noteRes.json();
  const tsData   = await tsRes.json();

  noteInput.value       = noteData.note_text || '';
  noteStatus.textContent = '';
  state.timestamps      = tsData;
  renderTimestamps();
}

// ── PLAYBACK ───────────────────────────────────────────────

playBtn.addEventListener('click', () => audio.paused ? audio.play() : audio.pause());

audio.addEventListener('play',  () => { playBtn.textContent = '⏸'; });
audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });

audio.addEventListener('timeupdate', () => {
  if (audio.duration) {
    progressBar.value    = (audio.currentTime / audio.duration) * 1000;
    tCurrent.textContent = fmt(audio.currentTime);
  }
});

audio.addEventListener('loadedmetadata', () => {
  tTotal.textContent = fmt(audio.duration);
});

progressBar.addEventListener('input', () => {
  if (audio.duration) audio.currentTime = (progressBar.value / 1000) * audio.duration;
});

volumeBar.addEventListener('input', () => {
  audio.volume = volumeBar.value / 100;
});

// ── RENAME ────────────────────────────────────────────────

renameBtn.addEventListener('click', () => {
  if (!state.currentSong) return;
  if (WEB_MODE) return;
  const titleEl  = $('np-title');
  const current  = state.currentSong.title;
  const input    = document.createElement('input');
  input.type      = 'text';
  input.value     = current;
  input.className = 'rename-input';
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    const restore = (text) => {
      const div = document.createElement('div');
      div.id = 'np-title';
      div.textContent = text;
      input.replaceWith(div);
    };
    if (!newName || newName === current) { restore(current); return; }
    const res  = await fetch(`/api/songs/${state.currentSong.id}/rename`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newName }),
    });
    const data = await res.json();
    if (res.ok) {
      state.currentSong.title = data.title;
      state.currentSong.filepath = data.filepath;
      const entry = state.songs.find(s => s.id === state.currentSong.id);
      if (entry) { entry.title = data.title; entry.filepath = data.filepath; }
      restore(data.title);
      applyFilters();
    } else {
      restore(current);
      alert(data.error || 'Rename failed');
    }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { done = true; const d = document.createElement('div'); d.id='np-title'; d.textContent=current; input.replaceWith(d); }
  });
  input.addEventListener('blur', commit);
});

// ── DELETE (SOFT) ─────────────────────────────────────────

deleteBtn.addEventListener('click', async () => {
  if (!state.currentSong) return;
  const msg = WEB_MODE
    ? `Remove "${state.currentSong.title}" from this session?\n\nNotes and timestamps are saved and will return next time you load this folder.`
    : `Remove "${state.currentSong.title}" from your library?\n\nThe file stays on disk. Notes and timestamps are preserved in the database.`;
  if (!confirm(msg)) return;
  await fetch(`/api/songs/${state.currentSong.id}`, { method: 'DELETE' });
  state.songs = state.songs.filter(s => s.id !== state.currentSong.id);
  state.currentSong = null;
  $('player-panel').classList.add('hidden');
  $('empty-state').classList.remove('hidden');
  applyFilters();
});

// ── MARK TIMESTAMP ────────────────────────────────────────

markBtn.addEventListener('click', async () => {
  if (!state.currentSong) return;

  // Flush any label currently being typed before we re-render
  const activeLabel = tsList.querySelector('.ts-label:focus');
  if (activeLabel && activeLabel.value !== activeLabel.dataset.saved) {
    await fetch(`/api/timestamps/${activeLabel.dataset.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: activeLabel.value }),
    });
  }

  const res = await fetch(`/api/songs/${state.currentSong.id}/timestamps`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ time_seconds: audio.currentTime }),
  });
  const ts = await res.json();
  state.timestamps.push(ts);
  state.timestamps.sort((a, b) => a.time_seconds - b.time_seconds);
  renderTimestamps();

  // Auto-focus the label input for this new marker
  setTimeout(() => {
    const input = tsList.querySelector(`.ts-label[data-id="${ts.id}"]`);
    if (input) input.focus();
  }, 50);
});

// ── RENDER TIMESTAMPS ────────────────────────────────────

function renderTimestamps() {
  tsCount.textContent = state.timestamps.length || '';
  if (!state.timestamps.length) {
    tsList.innerHTML = '<li class="ts-empty muted">No markers yet — hit Mark This Moment while playing</li>';
    return;
  }
  tsList.innerHTML = '';
  for (const ts of state.timestamps) {
    const li = document.createElement('li');
    li.className = 'ts-item';
    li.innerHTML = `
      <span class="ts-time" data-time="${ts.time_seconds}">${fmt(ts.time_seconds)}</span>
      <input class="ts-label" type="text" data-id="${ts.id}" value="${esc(ts.label)}" placeholder="label this moment...">
      <button class="ts-del" data-id="${ts.id}" title="Delete">✕</button>
    `;

    li.querySelector('.ts-time').addEventListener('click', e => {
      audio.currentTime = parseFloat(e.target.dataset.time);
    });

    const labelInput = li.querySelector('.ts-label');
    labelInput.dataset.saved = ts.label;
    labelInput.addEventListener('input', async e => {
      await fetch(`/api/timestamps/${e.target.dataset.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ label: e.target.value }),
      });
      e.target.dataset.saved = e.target.value;
    });

    li.querySelector('.ts-del').addEventListener('click', async e => {
      const id = parseInt(e.target.dataset.id);
      await fetch(`/api/timestamps/${id}`, { method: 'DELETE' });
      state.timestamps = state.timestamps.filter(t => t.id !== id);
      renderTimestamps();
    });

    tsList.appendChild(li);
  }
}

// ── NOTES ────────────────────────────────────────────────

let noteSaveTimer;
noteInput.addEventListener('input', () => {
  noteStatus.textContent = 'saving...';
  clearTimeout(noteSaveTimer);
  noteSaveTimer = setTimeout(async () => {
    if (!state.currentSong) return;
    await fetch(`/api/songs/${state.currentSong.id}/notes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ note_text: noteInput.value }),
    });
    noteStatus.textContent = '✓ saved';
    setTimeout(() => { noteStatus.textContent = ''; }, 2000);

    // Update sidebar flag live
    const hasNote = noteInput.value.trim().length > 0;
    const entry = state.songs.find(s => s.id === state.currentSong.id);
    if (entry) entry.has_note = hasNote ? 1 : 0;
    const li = songList.querySelector(`li[data-id="${state.currentSong.id}"]`);
    if (li) {
      const titleEl = li.querySelector('.song-item-title');
      const flag = titleEl.querySelector('.note-flag');
      if (hasNote && !flag) titleEl.insertAdjacentHTML('beforeend', '<span class="note-flag">📝</span>');
      else if (!hasNote && flag) flag.remove();
    }
  }, 800);
});

// ── SEARCH ───────────────────────────────────────────────

function applyFilters() {
  const q    = searchInput.value.toLowerCase();
  let result = visibleSongs();
  if (q) result = result.filter(s =>
    s.title.toLowerCase().includes(q) ||
    (s.artist && s.artist.toLowerCase().includes(q)) ||
    (s.album  && s.album.toLowerCase().includes(q))
  );
  renderSongList(result);
}

searchInput.addEventListener('input', applyFilters);

// ── NOTED FILTER ─────────────────────────────────────────

notedFilter.addEventListener('click', () => {
  state.notedOnly = !state.notedOnly;
  notedFilter.classList.toggle('active', state.notedOnly);
  notedFilter.textContent = state.notedOnly ? '📝 Showing noted' : '📝 Noted only';
  applyFilters();
});

// ── CSV IMPORT ────────────────────────────────────────────

const importBtn  = $('import-btn');
const importFile = $('import-file');

if (importBtn) {
  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    importFile.value = '';

    importBtn.textContent = '⏳ Importing...';
    importBtn.disabled = true;

    try {
      const csv = await file.text();
      const res  = await fetch('/api/import/csv', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ csv }),
      });
      const data = await res.json();

      if (!res.ok) {
        showImportToast('error', data.error || 'Import failed');
        return;
      }

      const parts = [];
      if (data.songs_added)      parts.push(`${data.songs_added} added`);
      if (data.songs_updated)    parts.push(`${data.songs_updated} updated`);
      if (data.notes_set)        parts.push(`${data.notes_set} notes`);
      if (data.timestamps_added) parts.push(`${data.timestamps_added} markers`);
      const summary = parts.length ? parts.join(', ') : 'nothing new';
      showImportToast('ok', `Import complete — ${summary}`);

      // Reload songs if any were added/updated
      if (data.songs_added || data.songs_updated) {
        const songs = await (await fetch('/api/songs')).json();
        state.songs = songs;
        applyFilters();
      }
    } catch (e) {
      showImportToast('error', 'Import failed: ' + e.message);
    } finally {
      importBtn.textContent = '⬆ Import CSV';
      importBtn.disabled = false;
    }
  });
}

function showImportToast(type, msg) {
  const existing = document.querySelector('.import-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `import-toast import-toast-${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ── RESCAN PANEL ─────────────────────────────────────────

let scanPanelOpen = false;

rescanBtn.addEventListener('click', async () => {
  if (WEB_MODE) { pickAndScanDirectory(); return; }
  scanPanelOpen = !scanPanelOpen;
  scanPanel.classList.toggle('hidden', !scanPanelOpen);
  rescanBtn.textContent = scanPanelOpen ? '↑ Close' : '↻ Rescan Library';
  if (scanPanelOpen) {
    await loadFolders();
    await loadDrives();
  }
});

async function loadDrives() {
  const res    = await fetch('/api/drives');
  const drives = await res.json();
  const tracked = (await (await fetch('/api/scan-dirs')).json()).map(d => d.dirpath.replace(/\\/g, '/').toUpperCase());
  drivesList.innerHTML = '';
  for (const drive of drives) {
    const chip = document.createElement('button');
    chip.className = 'drive-chip';
    chip.textContent = drive.replace('\\', '');
    const norm = drive.replace(/\\/g, '/').toUpperCase();
    if (tracked.some(t => t.startsWith(norm))) chip.classList.add('active');
    chip.addEventListener('click', async () => {
      folderInput.value = drive;
      folderInput.focus();
    });
    drivesList.appendChild(chip);
  }
}

scanNowBtn.addEventListener('click', async () => {
  scanNowBtn.textContent = '↻ Scanning...';
  scanNowBtn.disabled = true;
  try {
    const res  = await fetch('/api/rescan', { method: 'POST' });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.songs = data.songs;
    applyFilters();
    scanNowBtn.textContent = `✓ ${data.added} added, ${data.removed} removed`;
  } catch (err) {
    scanNowBtn.textContent = '↻ Scan failed';
    alert('Scan failed: ' + (err.message || 'unknown error'));
  }
  setTimeout(() => {
    scanNowBtn.textContent = '↻ Scan Now';
    scanNowBtn.disabled = false;
  }, 2500);
});

// ── KEYBOARD ─────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'KeyM' && state.currentSong) {
    e.preventDefault();
    markBtn.click();
  }
});

// ── SCAN FOLDERS ─────────────────────────────────────────

async function loadFolders() {
  const res  = await fetch('/api/scan-dirs');
  const dirs = await res.json();
  foldersList.innerHTML = '';
  if (!dirs.length) {
    foldersList.innerHTML = '<li style="color:var(--muted);font-size:11px;padding:3px 2px;font-style:italic">None — using default folder</li>';
    return;
  }
  for (const d of dirs) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="folder-path" title="${esc(d.dirpath)}">${esc(d.dirpath)}</span><button class="folder-del" data-id="${d.id}" title="Remove">✕</button>`;
    li.querySelector('.folder-del').addEventListener('click', async e => {
      await fetch(`/api/scan-dirs/${e.target.dataset.id}`, { method: 'DELETE' });
      loadFolders();
      loadDrives();
    });
    foldersList.appendChild(li);
  }
}

async function addFolder() {
  const dirpath = folderInput.value.trim();
  if (!dirpath) return;
  folderError.textContent = '';
  const res = await fetch('/api/scan-dirs', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ dirpath }),
  });
  if (res.ok) {
    folderInput.value = '';
    loadFolders();
    loadDrives();
  } else {
    const data = await res.json();
    folderError.textContent = data.error || 'Failed to add folder';
  }
}

folderAddBtn.addEventListener('click', addFolder);
folderInput.addEventListener('keydown', e => { if (e.key === 'Enter') addFolder(); });

// ── WEB MODE: FILE SYSTEM ACCESS API ─────────────────────

async function pickAndScanDirectory() {
  if (!window.showOpenFilePicker) {
    alert('Your browser does not support file picking.\nTry Chrome or Edge.');
    return;
  }
  let handles;
  try {
    handles = await window.showOpenFilePicker({
      startIn: 'music',
      multiple: true,
      types: [{
        description: 'Audio files',
        accept: {
          'audio/mpeg':  ['.mp3'],
          'audio/mp4':   ['.m4a', '.aac'],
          'audio/wav':   ['.wav'],
          'audio/flac':  ['.flac'],
          'audio/ogg':   ['.ogg'],
        },
      }],
      excludeAcceptAllOption: false,
    });
  } catch (e) {
    if (e.name !== 'AbortError') alert('Could not open file picker:\n' + e.message);
    return;
  }

  rescanBtn.textContent = '↻ Loading...';
  rescanBtn.disabled = true;

  const pending = [];
  for (const handle of handles) {
    const file = await handle.getFile();
    const duration = await getDuration(file);
    pending.push({ filepath: `web:${file.name}`, title: file.name.replace(/\.[^.]+$/, ''), artist: '', album: '', duration_sec: duration, _file: file });
  }

  const res = await fetch('/api/songs/web-upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pending.map(({ _file, ...s }) => s)),
  });
  const serverSongs = await res.json();

  for (const ss of serverSongs) {
    const p = pending.find(s => s.filepath === ss.filepath);
    if (p) fileHandles.set(ss.id, p._file);
  }

  // Merge new files into existing list (don't wipe — allow adding more)
  const existingIds = new Set(state.songs.map(s => s.id));
  for (const s of serverSongs) {
    if (!existingIds.has(s.id)) state.songs.push(s);
    else { const i = state.songs.findIndex(x => x.id === s.id); if (i >= 0) state.songs[i] = s; }
  }
  state.songs.sort((a, b) => (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title));
  applyFilters();

  rescanBtn.textContent = `✓ ${handles.length} added`;
  setTimeout(() => { rescanBtn.textContent = '🎵 Add Files'; rescanBtn.disabled = false; }, 2000);
}

function getDuration(file) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    a.addEventListener('loadedmetadata', () => { URL.revokeObjectURL(url); resolve(a.duration || 0); });
    a.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0); });
    a.src = url;
  });
}

// ── CHATBOT ──────────────────────────────────────────────

const chatFab      = $('chat-fab');
const chatPanel    = $('chat-panel');
const chatClose    = $('chat-close');
const chatMessages = $('chat-messages');
const chatInput    = $('chat-input');
const chatSend     = $('chat-send');

const CHAT_SYSTEM = 'You are AudioNote Assistant — a helpful guide for the AudioNote app (local MP3 catalog, player, and annotation tool). Help users with: playing and organizing music, using timestamp markers, writing song notes, scanning folders, exporting CSV data, and general questions about how AudioNote works. Be concise and friendly.';

chatFab.addEventListener('click', () => {
  chatPanel.classList.toggle('hidden');
  if (!chatPanel.classList.contains('hidden')) chatInput.focus();
});
chatClose.addEventListener('click', () => chatPanel.classList.add('hidden'));

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';

  appendMsg(text, 'user');
  const thinking = appendMsg('Thinking…', 'bot thinking');

  try {
    const res  = await fetch('https://claudeamour.us/claude/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message: text, system: CHAT_SYSTEM }),
    });
    const data = await res.json();
    thinking.remove();
    appendMsg(data.reply || data.content || 'No response', 'bot');
  } catch {
    thinking.remove();
    appendMsg('Could not reach the assistant. Please try again.', 'bot');
  }
}

function appendMsg(text, classes) {
  const div = document.createElement('div');
  div.className = `chat-msg ${classes}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ── INIT ─────────────────────────────────────────────────

if (WEB_MODE) {
  rescanBtn.textContent = '🎵 Add Files';
  scanPanel.classList.add('hidden');
  renameBtn.classList.add('hidden');
  const homeAddBtn = $('home-add-btn');
  if (homeAddBtn) homeAddBtn.addEventListener('click', pickAndScanDirectory);
} else {
  const homeAddBtn = $('home-add-btn');
  if (homeAddBtn) homeAddBtn.style.display = 'none';
  const homeNote = document.querySelector('.home-browser-note');
  if (homeNote) homeNote.textContent = 'Click ↻ Rescan Library in the sidebar to load your music';
  loadSongs();
  loadFolders();
}
