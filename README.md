# AudioNote

**Version 0.0.00.1** — *A TheRatsAsses Music Release, dba LibCSystems*

AudioNote is a local-first music catalog and annotation tool. Point it at a folder of MP3 files, and it gives you a clean browser interface to play tracks, write notes, and drop timestamped markers while you listen — all stored in a local SQLite database that never leaves your machine.

---

## What It Does

- **Catalogs** your MP3 library by scanning a folder recursively for audio files
- **Reads ID3 metadata** — title, artist, album, and duration pulled directly from each file
- **Plays tracks** in the browser with a full-featured audio player (seek, volume, progress)
- **Song notes** — freetext notes per track, auto-saved as you type
- **Timestamp markers** — hit the Mark button (or press `M`) while a track plays to drop a marker at the exact moment; add a label, click any marker to jump back to it
- **Annotated filter** — sidebar flag (📝) on any noted track; one-click "Noted only" filter to get back to your work
- **Rescan** — adds new files and prunes deleted ones from the catalog without touching your notes or markers

---

## How It Works

AudioNote runs as a Node.js/Express server on your local machine. On first run (and on each Rescan), it walks the **parent directory** of wherever the app lives, finds every `.mp3` file, reads its ID3 tags via `music-metadata`, and inserts new entries into a local SQLite database using Node's built-in `node:sqlite` module — no native compilation, no external database engine.

All notes and timestamp markers you create are written back to that same database. The database file (`audionote.db`) lives next to the app and is **yours** — it is excluded from this repository. Every installation starts with a clean, empty database.

```
your-music-folder/
├── www/                 ← AudioNote lives here
│   ├── app.js
│   ├── db.js
│   ├── package.json
│   ├── audionote.db     ← created on first run, gitignored
│   └── public/
│       ├── index.html
│       ├── style.css
│       └── client.js
├── song1.mp3
├── artist-folder/
│   └── song2.mp3
└── ...
```

The server scans `../` relative to `app.js`, so the folder layout above is all that's needed — no configuration file required.

---

## Requirements

- **Node.js 22.5 or later** (uses the built-in `node:sqlite` module introduced in v22.5)

---

## Setup

```bash
git clone https://github.com/LIBCSYS/audionote
```

Place the cloned `audionote` folder inside your music directory, renaming it `www` (or whatever subdirectory name you prefer):

```
your-music-folder/
└── www/          ← put the cloned repo here
```

Then install dependencies and start:

```bash
cd www
npm install
node app.js
```

Open **http://localhost:3005** in your browser. Click **↻ Rescan Library** to scan your music folder and populate the catalog.

---

## Network Access

The server binds to `0.0.0.0:3005` and is accessible from any machine on your local network or VPN:

```
http://<your-machine-ip>:3005
```

On Windows, open the port in the firewall:

```
netsh advfirewall firewall add rule name="AudioNote" dir=in action=allow protocol=TCP localport=3005
```

---

## Customization

The two values most likely to need changing are at the top of `app.js`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3005` | Port the server listens on |
| `MUSIC_ROOT` | `path.join(__dirname, '..')` | Folder to scan for MP3s |

---

## Roadmap

- Vocal line tabulation and markup
- Chord / riff transposition tools
- Timestamp export (JSON, CSV)
- Multi-format support (FLAC, WAV, AAC)
- Multi-user / shared annotation

---

## License

MIT

---

*A TheRatsAsses Music Release — dba LibCSystems*  
*© 2026 LibCSystems LLC*
