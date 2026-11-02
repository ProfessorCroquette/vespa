use lofty::prelude::*;
use lofty::probe::Probe;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

// ---------- Read tags from one audio file ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackInfo {
    title: String,
    artist: String,
    duration: f64,
    bitrate: u32,
    sample_rate: u32,
    artwork_path: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedPlaylist {
    id: String,
    name: String,
    paths: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedFile {
    version: u32,
    active_id: String,
    playlists: Vec<SavedPlaylist>,
}

#[tauri::command]
fn read_tags(path: String) -> Result<TrackInfo, String> {
    let tagged = Probe::open(&path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let props = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    // Extract album art (if present) and save it to a temp file.
    let artwork_path = tag
        .and_then(|t| t.pictures().first())
        .and_then(|pic| save_artwork(&path, pic.data(), pic.mime_type()));

    Ok(TrackInfo {
        title: tag.and_then(|t| t.title().map(|s| s.to_string())).unwrap_or_default(),
        artist: tag.and_then(|t| t.artist().map(|s| s.to_string())).unwrap_or_default(),
        duration: props.duration().as_secs_f64(),
        bitrate: props.audio_bitrate().unwrap_or(0),
        sample_rate: props.sample_rate().unwrap_or(0),
        artwork_path,
    })
}

/// Writes the embedded picture bytes to a stable temp file and returns its path.
/// Returns `None` on any I/O failure — the frontend then falls back to a default.
fn save_artwork(
    audio_path: &str,
    data: &[u8],
    mime: Option<&lofty::picture::MimeType>,
) -> Option<String> {
    let ext = match mime.map(|m| m.as_str()) {
        Some("image/png")  => "png",
        Some("image/webp") => "webp",
        Some("image/gif")  => "gif",
        Some("image/bmp")  => "bmp",
        _                  => "jpg",
    };

    let mut dir = std::env::temp_dir();
    dir.push("vespa-artwork");
    fs::create_dir_all(&dir).ok()?;

    let stem = Path::new(audio_path)
        .file_stem()?
        .to_string_lossy()
        .replace(|c: char| !c.is_alphanumeric(), "_");

    let out: PathBuf = dir.join(format!("{stem}.{ext}"));

    if !out.exists() {
        fs::write(&out, data).ok()?;
    }

    Some(out.to_string_lossy().into_owned())
}

// ---------- Playlists persistence ----------

fn playlists_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    dir.push("playlists.json");
    Ok(dir)
}

#[tauri::command]
fn load_playlists(app: tauri::AppHandle) -> Result<Option<SavedFile>, String> {
    let path = playlists_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: SavedFile = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}

#[tauri::command]
fn save_playlists(app: tauri::AppHandle, data: SavedFile) -> Result<(), String> {
    let path = playlists_path(&app)?;
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Find audio files in a folder and all its children ----------

fn walk(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let p = entry.path();

        if p.is_dir() {
            walk(&p, out);
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let ext = ext.to_lowercase();
            if ["mp3", "flac", "ogg", "wav", "m4a", "opus"].contains(&ext.as_str()) {
                out.push(p.to_string_lossy().into_owned());
            }
        }
    }
}

#[tauri::command]
fn scan_folder(path: String) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(&path), &mut out);
    out.sort();
    out
}

// ---------- App entry ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_tags,
            scan_folder,
            load_playlists,
            save_playlists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}