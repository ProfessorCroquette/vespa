# Vespa

A minimal, frameless desktop music player built with **Tauri v2** and **TypeScript**.
Yellow-on-black, keyboard-friendly, and designed to feel like a native app — not a webpage in a window.

![Vespa screenshot](docs/screenshot.png)

---

## Features

- **Folder scanning** — recursively finds `mp3`, `flac`, `ogg`, `wav`, `m4a`, `opus`
- **Multiple playlists** — create, rename, delete, switch on the fly
- **Persistent playlists** — saved to `playlists.json` in the app data directory
- **Metadata** — reads title, artist, duration, bitrate, sample rate, and embedded album art via [lofty](https://github.com/Serial-ATA/lofty-rs)
- **Search + sort** — filter the active playlist live; sort by path, title, or duration
- **Playback** — play/pause, prev/next, shuffle, repeat (off/all/one), seek, volume
- **Mini mode** — shrinks to a small always-on-top bar; drag anywhere to move
- **Frameless window** — square corners, custom chrome, drag via the logo
- **Copy/paste/context-menu disabled** — behaves like a native app, not a browser

---

## Requirements

- **Node.js** 18+
- **Rust** (stable) — install via [rustup](https://rustup.rs)
- **Platform prerequisites** for Tauri v2 — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

On **Windows** you also need the Microsoft C++ Build Tools (installed via the Visual Studio Build Tools installer).

---

## Development

```bash
npm install
npm run tauri dev
