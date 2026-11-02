import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import defaultCover from "./vespa.png";

// ---------- elements ----------
const title      = document.querySelector("#now-title")!;
const cur        = document.querySelector("#cur")!;
const dur        = document.querySelector("#dur")!;
const playIcon   = document.querySelector("#play use")!;
const seek       = document.querySelector("#seek") as HTMLInputElement;
const vol        = document.querySelector("#vol") as HTMLInputElement;
const list       = document.querySelector("#list")!;
const repeatBtn  = document.querySelector("#repeat")!;
const repeatIcon = document.querySelector("#repeat use")!;
const shuffleBtn = document.querySelector("#shuffle")!;
const nowArtist  = document.querySelector("#now-artist")!;
const nowMeta    = document.querySelector("#now-meta")!;
const cover      = document.querySelector("#cover") as HTMLImageElement;

const mini         = document.querySelector("#mini") as HTMLElement;
const miniCover    = document.querySelector("#mini-cover") as HTMLImageElement;
const miniTitle    = document.querySelector("#mini-title")!;
const miniArtist   = document.querySelector("#mini-artist")!;
const miniPlayIcon = document.querySelector("#mini-play use")!;

const tabsEl = document.querySelector("#tabs")!;
const search = document.querySelector("#search") as HTMLInputElement;

const appWindow = getCurrentWindow();
const tabAddBtn = document.querySelector("#tab-add")!;

// ---------- types ----------
interface TrackInfo {
  title: string;
  artist: string;
  duration: number;
  bitrate: number;
  sampleRate: number;
  artworkPath: string | null;
}

interface TrackRow {
  path: string;
  title: string;
  time: string;
  meta: string;
}

interface Playlist {
  id: string;
  name: string;
  rows: TrackRow[];
}

interface SavedPlaylist {
  id: string;
  name: string;
  paths: string[];
}

interface SavedFile {
  version: number;
  active_id: string;
  playlists: SavedPlaylist[];
}

// ---------- state ----------
const audio = new Audio();

let playlists: Playlist[] = [
  { id: "default", name: "Default", rows: [] },
];
let activeId = "default";

let view: TrackRow[] = [];
let index = 0;

let dragging = false;
let repeat: "off" | "all" | "one" = "off";
let shuffle = false;

let searchQuery = "";
type SortMode = "path" | "title" | "duration";
const sortModes: SortMode[] = ["path", "title", "duration"];
let sortMode: SortMode = "path";

let miniMode = false;
let savedSize: { width: number; height: number } | null = null;

let renaming = false;

const tagCache = new Map<string, TrackInfo>();

// ---------- helpers ----------
function fmt(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function newPlaylistId(): string {
  return "pl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop()!;
}

function folderOf(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts[parts.length - 1] || "(root)";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function setSeek(fraction: number) {
  seek.value = String(fraction * 1000);
  seek.style.setProperty("--p", fraction * 100 + "%");
}

function parseTime(t: string): number {
  const [m, s] = t.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

async function readTags(path: string): Promise<TrackInfo> {
  const hit = tagCache.get(path);
  if (hit) return hit;
  const info = await invoke<TrackInfo>("read_tags", { path });
  tagCache.set(path, info);
  return info;
}

function active(): Playlist {
  return playlists.find(p => p.id === activeId) ?? playlists[0];
}

function rebuildView() {
  let base = active().rows.slice();

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    base = base.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q)
    );
  }

  if (sortMode === "path") {
    base.sort((a, b) => a.path.localeCompare(b.path));
  } else if (sortMode === "title") {
    base.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    base.sort((a, b) => parseTime(a.time) - parseTime(b.time));
  }

  view = base;
  if (index >= view.length) index = 0;
}

// ---------- persistence ----------
let saveTimer: number | undefined;

function scheduleSave() {
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(doSave, 400);
}

async function doSave() {
  try {
    const data: SavedFile = {
      version: 1,
      active_id: activeId,
      playlists: playlists.map(p => ({
        id: p.id,
        name: p.name,
        paths: p.rows.map(r => r.path),
      })),
    };
    await invoke("save_playlists", { data });
  } catch (e) {
    console.warn("save_playlists failed:", e);
  }
}

async function loadSaved() {
  try {
    const file = await invoke<SavedFile | null>("load_playlists");
    if (!file || !file.playlists || file.playlists.length === 0) return;

    playlists = file.playlists.map(p => ({
      id: p.id,
      name: p.name,
      rows: p.paths.map(path => ({
        path,
        title: fileName(path),
        time: "0:00",
        meta: path.split(".").pop()!.toUpperCase(),
      })),
    }));

    if (!playlists.some(p => p.id === "default")) {
      playlists.unshift({ id: "default", name: "Default", rows: [] });
    }

    activeId = playlists.some(p => p.id === file.active_id) ? file.active_id : "default";
    index = 0;
    rebuildView();
    render();

    for (const pl of playlists) {
      for (const row of pl.rows) {
        readTags(row.path)
          .then((info) => {
            row.title = info.title
              ? (info.artist ? `${info.artist} - ${info.title}` : info.title)
              : fileName(row.path);
            row.time = fmt(info.duration);
            row.meta = [
              row.path.split(".").pop()!.toUpperCase(),
              info.sampleRate ? `${Math.round(info.sampleRate / 1000)} kHz` : null,
              info.bitrate ? `${info.bitrate} kbps` : null,
            ].filter(Boolean).join(" :: ");

            if (pl.id === activeId) {
              const vi = view.findIndex(v => v.path === row.path);
              if (vi !== -1) patchRow(vi);
            }
          })
          .catch(() => { /* file may be gone; leave fallback */ });
      }
    }
  } catch (e) {
    console.warn("load_playlists failed:", e);
  }
}

// ---------- rename ----------
function startRename(id: string) {
  if (renaming) return;

  const el = tabsEl.querySelector(`.tab[data-pl="${id}"]`) as HTMLElement | null;
  if (!el) return;
  if (el.querySelector("input")) return;

  const pl = playlists.find(p => p.id === id);
  if (!pl) return;

  const original = pl.name;
  renaming = true;

  el.innerHTML = `<input type="text" value="${escapeHtml(original)}" />`;
  const input = el.querySelector("input")!;
  input.focus();
  input.select();

  let done = false;

  const commit = () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    pl.name = v || original;
    renaming = false;
    render();
    scheduleSave();
  };

  const cancel = () => {
    if (done) return;
    done = true;
    pl.name = original;
    renaming = false;
    render();
  };

  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
}

tabsEl.addEventListener("dblclick", (e) => {
  const el = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
  if (!el) return;
  const id = el.dataset.pl;
  if (!id) return;
  startRename(id);
});

// ---------- playback ----------
async function play(i: number) {
  if (i < 0 || i >= view.length) return;
  index = i;

  const path = view[i].path;
  audio.src = convertFileSrc(path);
  audio.play();

  title.textContent = fileName(path);
  nowArtist.textContent = "";
  nowMeta.textContent = "";
  cover.removeAttribute("src");
  syncMini();

  render();

  try {
    const info = await readTags(path);
    if (index !== i) return;

    title.textContent = info.title || fileName(path);
    nowArtist.textContent = info.artist || "Unknown artist";

    const ext  = path.split(".").pop()!.toUpperCase();
    const khz  = info.sampleRate ? `${Math.round(info.sampleRate / 1000)} kHz` : null;
    const kbps = info.bitrate ? `${info.bitrate} kbps` : null;
    nowMeta.textContent = [ext, khz, kbps].filter(Boolean).join(" :: ");

    cover.src = info.artworkPath
      ? convertFileSrc(info.artworkPath)
      : defaultCover;

    syncMini();
  } catch (e) {
    console.warn("read_tags failed for", path, e);
    cover.src = defaultCover;
    syncMini();
  }
}

// ---------- list ----------
function render() {
  if (!renaming) {
    tabsEl.innerHTML = playlists
      .map(p => `<div class="tab ${p.id === activeId ? "active" : ""}" data-pl="${p.id}" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>`)
      .join("");
  }

  if (view.length === 0) {
    list.innerHTML = "";
    return;
  }

  let lastFolder = "";
  const html: string[] = [];

  view.forEach((r, i) => {
    const folder = folderOf(r.path);

    if (folder !== lastFolder) {
      html.push(`<li class="folder-header">${escapeHtml(folder)}</li>`);
      lastFolder = folder;
    }

    html.push(`
      <li class="track ${i === index ? "playing" : ""}" data-i="${i}">
        <div class="track-name">${escapeHtml(r.title)}</div>
        <div class="track-time">${r.time}</div>
        <div class="track-meta">${escapeHtml(r.meta)}</div>
      </li>`);
  });

  list.innerHTML = html.join("");
}

function patchRow(i: number) {
  const li = list.querySelector(`li.track[data-i="${i}"]`);
  if (!li) return;
  const r = view[i];
  if (!r) return;
  (li.querySelector(".track-name") as HTMLElement).textContent = r.title;
  (li.querySelector(".track-time") as HTMLElement).textContent = r.time;
  (li.querySelector(".track-meta") as HTMLElement).textContent = r.meta;
}

list.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest("li.track") as HTMLElement | null;
  if (!li) return;

  const raw = li.dataset.i;
  if (raw === undefined) return;

  const i = Number(raw);
  if (Number.isNaN(i)) return;

  if (i === index) return;
  play(i);
});

// ---------- add folder ----------
document.querySelector("#add")!.addEventListener("click", async () => {
  const dir = await open({ directory: true });
  if (!dir) return;

  const paths = await invoke<string[]>("scan_folder", { path: dir });
  tagCache.clear();

  const pl = active();
  pl.rows = paths.map((p) => ({
    path: p,
    title: fileName(p),
    time: "0:00",
    meta: p.split(".").pop()!.toUpperCase(),
  }));
  pl.rows.sort((a, b) => a.path.localeCompare(b.path));

  rebuildView();
  render();
  if (view.length) play(0);

  pl.rows.forEach((row) => {
    readTags(row.path)
      .then((info) => {
        row.title = info.title
          ? (info.artist ? `${info.artist} - ${info.title}` : info.title)
          : fileName(row.path);
        row.time = fmt(info.duration);
        row.meta = [
          row.path.split(".").pop()!.toUpperCase(),
          info.sampleRate ? `${Math.round(info.sampleRate / 1000)} kHz` : null,
          info.bitrate ? `${info.bitrate} kbps` : null,
        ].filter(Boolean).join(" :: ");

        const vi = view.findIndex(v => v.path === row.path);
        if (vi !== -1) patchRow(vi);
      })
      .catch(() => { /* leave fallback */ });
  });

  scheduleSave();
});

// ---------- new playlist ----------
tabAddBtn.addEventListener("click", () => {
  const base = "Playlist";
  let n = 1;
  let name = base;
  while (playlists.some(p => p.name === name)) {
    n++;
    name = `${base} ${n}`;
  }

  const pl: Playlist = { id: newPlaylistId(), name, rows: [] };
  playlists.push(pl);
  activeId = pl.id;
  index = 0;
  rebuildView();
  render();

  startRename(pl.id);
  scheduleSave();
});

// ---------- tabs ----------
tabsEl.addEventListener("click", (e) => {
  if (renaming) return;
  const el = (e.target as HTMLElement).closest(".tab") as HTMLElement | null;
  if (!el) return;
  const id = el.dataset.pl;
  if (!id || id === activeId) return;

  activeId = id;
  index = 0;
  rebuildView();
  render();
  if (view.length) play(0);
  scheduleSave();
});

// ---------- search ----------
search.addEventListener("input", () => {
  searchQuery = search.value;
  rebuildView();
  render();
});

// ---------- sort ----------
document.querySelector("#sort")!.addEventListener("click", () => {
  const i = sortModes.indexOf(sortMode);
  sortMode = sortModes[(i + 1) % sortModes.length];
  document.querySelector("#sort")!.setAttribute("title", `Sort: ${sortMode}`);
  rebuildView();
  render();
});

// ---------- delete playlist ----------
document.querySelector("#del")!.addEventListener("click", () => {
  if (activeId === "default") {
    alert("Default playlist cannot be deleted.");
    return;
  }

  const i = playlists.findIndex(p => p.id === activeId);
  if (i === -1) return;

  playlists.splice(i, 1);
  activeId = "default";
  index = 0;
  rebuildView();
  render();
  if (view.length) play(0);
  scheduleSave();
});

// ---------- controls ----------
shuffleBtn.addEventListener("click", () => {
  shuffle = !shuffle;
  shuffleBtn.classList.toggle("on", shuffle);
});

document.querySelector("#prev")!.addEventListener("click", () => {
  if (view.length === 0) return;
  play((index - 1 + view.length) % view.length);
});

document.querySelector("#next")!.addEventListener("click", () => {
  play(nextIndex());
});

document.querySelector("#play")!.addEventListener("click", () => {
  if (audio.paused) audio.play();
  else audio.pause();
});

repeatBtn.addEventListener("click", () => {
  repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
  repeatBtn.classList.toggle("on", repeat !== "off");
  repeatIcon.setAttribute("href", repeat === "one" ? "#i-repeat-one" : "#i-repeat");
  repeatBtn.setAttribute("title", "Repeat: " + repeat);
});

function nextIndex(): number {
  if (view.length === 0) return 0;
  if (!shuffle || view.length < 2) {
    return (index + 1) % view.length;
  }
  let r: number;
  do {
    r = Math.floor(Math.random() * view.length);
  } while (r === index);
  return r;
}

// ---------- window controls ----------
document.querySelector("#min")!.addEventListener("click", () => {
  enterMini();
});

document.querySelector("#close")!.addEventListener("click", () => {
  getCurrentWindow().close();
});

document.querySelector("#mini-restore")!.addEventListener("click", () => {
  exitMini();
});

document.querySelector("#mini-play")!.addEventListener("click", () => {
  if (audio.paused) audio.play();
  else audio.pause();
});

document.querySelector("#mini-next")!.addEventListener("click", () => {
  play(nextIndex());
});

document.querySelector("#mini-prev")!.addEventListener("click", () => {
  if (view.length === 0) return;
  play((index - 1 + view.length) % view.length);
});

// ---------- mini sync ----------
function syncMini() {
  const row = view[index];
  if (!row) return;
  miniTitle.textContent  = title.textContent    || "—";
  miniArtist.textContent = nowArtist.textContent || "—";
  if (cover.src) miniCover.src = cover.src;
}

audio.addEventListener("play", () => {
  playIcon.setAttribute("href", "#i-pause");
  miniPlayIcon.setAttribute("href", "#i-pause");
});

audio.addEventListener("pause", () => {
  playIcon.setAttribute("href", "#i-play");
  miniPlayIcon.setAttribute("href", "#i-play");
});

// ---------- volume ----------
audio.volume = Number(vol.value) / 100;
vol.addEventListener("input", () => {
  audio.volume = Number(vol.value) / 100;
});

// ---------- seek bar ----------
audio.addEventListener("timeupdate", () => {
  cur.textContent = fmt(audio.currentTime);
  dur.textContent = fmt(audio.duration);
  if (!dragging && Number.isFinite(audio.duration) && audio.duration > 0) {
    setSeek(audio.currentTime / audio.duration);
  }
});

seek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration)) return;
  const fraction = Number(seek.value) / 1000;
  audio.currentTime = fraction * audio.duration;
  setSeek(fraction);
});

seek.addEventListener("pointerdown", () => { dragging = true; });
window.addEventListener("pointerup",  () => { dragging = false; });

// ---------- audio events ----------
audio.addEventListener("ended", () => {
  if (repeat === "one") {
    audio.currentTime = 0;
    audio.play();
  } else if (shuffle || repeat === "all") {
    play(nextIndex());
  } else if (index + 1 < view.length) {
    play(index + 1);
  }
});

audio.addEventListener("loadedmetadata", () => {
  dur.textContent = fmt(audio.duration);
  setSeek(0);
});

// ---------- mini mode ----------
async function enterMini() {
  if (miniMode) return;
  miniMode = true;

  const size = await appWindow.innerSize();
  const factor = await appWindow.scaleFactor();
  savedSize = {
    width:  size.width  / factor,
    height: size.height / factor,
  };

  mini.hidden = false;
  document.body.classList.add("is-mini");
  syncMini();

  await appWindow.setSize(new LogicalSize(360, 62));
  await appWindow.setResizable(false);
  await appWindow.setAlwaysOnTop(true);
}

async function exitMini() {
  if (!miniMode) return;
  miniMode = false;

  document.body.classList.remove("is-mini");
  mini.hidden = true;

  await appWindow.setResizable(true);
  await appWindow.setAlwaysOnTop(false);

  const target = savedSize ?? { width: 800, height: 600 };
  await appWindow.setSize(new LogicalSize(target.width, target.height));
  savedSize = null;
}

// ---------- init ----------
cover.src = defaultCover;
miniCover.src = defaultCover;
rebuildView();
render();
loadSaved();