use lofty::prelude::*;
use lofty::probe::Probe;
use std::path::Path;

// ---------- Read tags from one audio file ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackInfo {
    title: String,
    artist: String,
    duration: f64,
    bitrate: u32,
    sample_rate: u32,
}

#[tauri::command]
fn read_tags(path: String) -> Result<TrackInfo, String> {
    let tagged = Probe::open(&path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let props = tagged.properties();
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());

    Ok(TrackInfo {
        title: tag.and_then(|t| t.title().map(|s| s.to_string())).unwrap_or_default(),
        artist: tag.and_then(|t| t.artist().map(|s| s.to_string())).unwrap_or_default(),
        duration: props.duration().as_secs_f64(),
        bitrate: props.audio_bitrate().unwrap_or(0),
        sample_rate: props.sample_rate().unwrap_or(0),
    })
}

// ---------- Find audio files in a folder and all its children ----------

fn walk(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };

    for entry in entries.flatten() {
        let p = entry.path();

        if p.is_dir() {
            walk(&p, out); // go into the child folder
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
        .invoke_handler(tauri::generate_handler![read_tags, scan_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}