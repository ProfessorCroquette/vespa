import { open } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

// ---------- elements ----------
const title    = document.querySelector("#now-title")!;
const cur      = document.querySelector("#cur")!;
const dur      = document.querySelector("#dur")!;
const playIcon = document.querySelector("#play use")!;
const seek     = document.querySelector("#seek") as HTMLInputElement;
const vol      = document.querySelector("#vol") as HTMLInputElement;
const list     = document.querySelector("#list")!;
const repeatBtn  = document.querySelector("#repeat")!;
const repeatIcon = document.querySelector("#repeat use")!
const shuffleBtn = document.querySelector("#shuffle")!;


// ---------- state ----------
const audio = new Audio();
let paths: string[] = [];
let index = 0;
let dragging = false;
let repeat: "off" | "all" | "one" = "off"; 
let shuffle = false;

// ---------- helpers ----------
function fmt(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop()!;
}

function setSeek(fraction: number) {
  seek.value = String(fraction * 1000);                 // slider is 0 to 1000
  seek.style.setProperty("--p", fraction * 100 + "%");  // yellow fill is 0 to 100
}

// ---------- playback ----------
function play(i: number) {
  if (i < 0 || i >= paths.length) return;
  index = i;
  audio.src = convertFileSrc(paths[i]);
  audio.play();
  title.textContent = fileName(paths[i]);
  render();
}

//---------- list ----------//


function render() {
  list.innerHTML = paths
    .map((p, i) => `
      <li class="track ${i === index ? "playing" : ""}" data-i="${i}">
        <div class="track-name">${fileName(p)}</div>
      </li>`)
    .join("");
}

list.addEventListener("click", (e) => {
  const li = (e.target as HTMLElement).closest("li.track") as HTMLElement | null;
  if (!li) return;

  const raw = li.dataset.i;
  if (raw === undefined) return; // placeholder <li> in the HTML has no data-i — ignore it

  const i = Number(raw);
  if (Number.isNaN(i)) return;

  play(i); // plays even if it's the current track (restarts it)
});

// ---------- buttons ----------
document.querySelector("#add")!.addEventListener("click", async () => {
  const dir = await open({ directory: true });
  if (!dir) return;
  paths = await invoke<string[]>("scan_folder", { path: dir });
  render()
  play(0);
});

shuffleBtn.addEventListener("click", () => {
  shuffle = !shuffle;
  shuffleBtn.classList.toggle("on", shuffle);
});

document.querySelector("#prev")!.addEventListener("click", () => {play((index - 1 + paths.length) % paths.length);});
document.querySelector("#next")!.addEventListener("click", () => {play(nextIndex());});

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
  if (!shuffle || paths.length < 2) {
    return (index + 1) % paths.length;   // normal order, wrapping around
  }

  let r: number;
  do {
    r = Math.floor(Math.random() * paths.length);
  } while (r === index);                 // never pick the song that's playing
  return r;
}

// ---------- volume ----------
audio.volume = Number(vol.value) / 100;
vol.addEventListener("input", () => {
  audio.volume = Number(vol.value) / 100;
});

// ---------- seek bar: song moves the bar ----------
audio.addEventListener("timeupdate", () => {
  cur.textContent = fmt(audio.currentTime);
  dur.textContent = fmt(audio.duration);

  if (!dragging && isFinite(audio.duration) && audio.duration > 0) {
    setSeek(audio.currentTime / audio.duration);
  }
});

// ---------- seek bar: bar moves the song ----------
seek.addEventListener("input", () => {
  if (!isFinite(audio.duration)) return;
  const fraction = Number(seek.value) / 1000;
  audio.currentTime = fraction * audio.duration;
  setSeek(fraction);
});

seek.addEventListener("pointerdown", () => { dragging = true; });
window.addEventListener("pointerup",  () => { dragging = false; });

// ---------- audio events ----------
audio.addEventListener("play",  () => playIcon.setAttribute("href", "#i-pause"));
audio.addEventListener("pause", () => playIcon.setAttribute("href", "#i-play"));
audio.addEventListener("ended", () => {
  if (repeat === "one") {
    audio.currentTime = 0;     // same song again
    audio.play();
  } else if (shuffle || repeat === "all") {
    play(nextIndex());    // wrap around to the first
  } else if (index + 1 < paths.length) {
    play(index + 1);           // off: go on, but stop at the end
  }
});

audio.addEventListener("loadedmetadata", () => {
  dur.textContent = fmt(audio.duration);
  setSeek(0);
});

