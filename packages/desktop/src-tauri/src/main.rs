// Slate desktop shell: a native window around the editor, plus the commands that run and
// export games with the native player (native/player).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod android;
mod plugins;
mod project;

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;

/// The native players, embedded at build time (build.rs: this OS's `cargo build --release` in
/// native/, others from CI). Empty when a build has none for that system.
static PLAYER_WINDOWS: &[u8] = include_bytes!(env!("SLATE_PLAYER_WINDOWS"));
static PLAYER_MACOS: &[u8] = include_bytes!(env!("SLATE_PLAYER_MACOS"));
static PLAYER_LINUX: &[u8] = include_bytes!(env!("SLATE_PLAYER_LINUX"));
/// The one that runs games from the editor (this system's)
#[cfg(windows)]
static PLAYER: &[u8] = PLAYER_WINDOWS;
#[cfg(target_os = "macos")]
static PLAYER: &[u8] = PLAYER_MACOS;
#[cfg(all(unix, not(target_os = "macos")))]
static PLAYER: &[u8] = PLAYER_LINUX;

const MAGIC: &[u8; 8] = b"SLATECRT";

/// The web player (native/web + the wasm build of the player); empty wasm if it wasn't built.
static WEB_WASM: &[u8] = include_bytes!(env!("SLATE_WEB_WASM"));
static WEB_FILES: [(&str, &[u8]); 4] = [
    ("index.html", include_bytes!("../../../../native/web/index.html")),
    ("mq_js_bundle.js", include_bytes!("../../../../native/web/mq_js_bundle.js")),
    ("slate.js", include_bytes!("../../../../native/web/slate.js")),
    (
        "licenses.txt",
        concat!(
            "Slate player
============

",
            include_str!("../../../../LICENSE"),
            "

",
            include_str!("../../../../native/player/THIRD_PARTY.txt"),
            "

ERXPIXEL fonts
==============

",
            include_str!("../../../../native/player/fonts/LICENSE-ERXPIXEL_A.txt"),
            "

",
            include_str!("../../../../native/player/fonts/LICENSE-ERXPIXEL_B.txt"),
            "

",
            include_str!("../../../../native/player/fonts/LICENSE-ERXPIXEL_GL.txt"),
        )
        .as_bytes(),
    ),
];

#[derive(Default)]
struct Runner(Mutex<Option<Child>>);

fn work_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("slate");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Write the player binary to the temp folder (once per version) and return its path.
fn player_path() -> Result<PathBuf, String> {
    if PLAYER.is_empty() {
        return Err("the native player is not available on this platform yet".into());
    }
    let path = work_dir()?.join(if cfg!(windows) { "slate-player.exe" } else { "slate-player" });
    let stale = std::fs::metadata(&path).map(|m| m.len() != PLAYER.len() as u64).unwrap_or(true);
    if stale {
        std::fs::write(&path, PLAYER).map_err(|e| format!("cannot write player: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
        }
    }
    Ok(path)
}

/// Replace the run cartridge atomically so the player never reads a half-written file.
fn write_run_cart(json: &str) -> Result<PathBuf, String> {
    let dir = work_dir()?;
    let path = dir.join("run.slate");
    let tmp = dir.join("run.slate.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn alive(child: &mut Option<Child>) -> bool {
    match child {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        None => false,
    }
}

/// Start the game in a native window, or hot-reload it if it is already running.
#[tauri::command]
fn run_cart(state: tauri::State<Runner>, json: String) -> Result<bool, String> {
    let path = write_run_cart(&json)?;
    let mut child = state.0.lock().map_err(|e| e.to_string())?;
    if alive(&mut child) {
        return Ok(false);
    }
    // the editor's console shows the game's log() output and its current error
    let dir = work_dir()?;
    let _ = std::fs::write(dir.join("log.txt"), "");
    let _ = std::fs::write(dir.join("error.txt"), "");
    let c = Command::new(player_path()?)
        .arg(path)
        .arg("--watch")
        .env("SLATE_LOGFILE", dir.join("log.txt"))
        .env("SLATE_ERRLOG", dir.join("error.txt"))
        .spawn()
        .map_err(|e| format!("cannot start player: {e}"))?;
    *child = Some(c);
    Ok(true)
}

/// Push edits into the running game (sprites reload in place, code changes restart it).
#[tauri::command]
fn update_cart(state: tauri::State<Runner>, json: String) -> Result<bool, String> {
    let mut child = state.0.lock().map_err(|e| e.to_string())?;
    if !alive(&mut child) {
        return Ok(false);
    }
    write_run_cart(&json)?;
    Ok(true)
}

#[tauri::command]
fn stop_cart(state: tauri::State<Runner>) -> Result<(), String> {
    let mut child = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut c) = child.take() {
        let _ = c.kill();
    }
    Ok(())
}

#[derive(serde::Serialize)]
struct PlayerOutput {
    error: String,
    log: String,
    offset: u64,
}

/// New log() lines since `offset` and the game's current error.
#[tauri::command]
fn player_output(offset: u64) -> Result<PlayerOutput, String> {
    let dir = work_dir()?;
    let error = std::fs::read_to_string(dir.join("error.txt")).unwrap_or_default();
    let all = std::fs::read(dir.join("log.txt")).unwrap_or_default();
    let start = (offset as usize).min(all.len());
    // keep the console light: at most the last 64 KB of new output
    let from = start.max(all.len().saturating_sub(64 * 1024));
    Ok(PlayerOutput { error, log: String::from_utf8_lossy(&all[from..]).into_owned(), offset: all.len() as u64 })
}

#[tauri::command]
fn is_running(state: tauri::State<Runner>) -> bool {
    state.0.lock().map(|mut c| alive(&mut c)).unwrap_or(false)
}

/// Export a standalone Windows game: [player][cartridge json][u64 len LE]["SLATECRT"].
#[tauri::command]
fn export_windows(json: String, path: String) -> Result<u64, String> {
    if PLAYER_WINDOWS.is_empty() {
        return Err("this Slate build has no Windows player".into());
    }
    let mut out = Vec::with_capacity(PLAYER_WINDOWS.len() + json.len() + 16);
    out.extend_from_slice(PLAYER_WINDOWS);
    out.extend_from_slice(json.as_bytes());
    out.extend_from_slice(&(json.len() as u64).to_le_bytes());
    out.extend_from_slice(MAGIC);
    std::fs::write(&path, &out).map_err(|e| format!("cannot write {path}: {e}"))?;
    Ok(out.len() as u64)
}

/// Open a web page (Help menu) in the default browser.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only web links".into());
    }
    #[cfg(windows)]
    let r = Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")]
    let r = Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// SLATE_UPDATE_TEST=<report file>: the editor checks for an update and downloads it (verifying the
/// signature) without installing, then writes what happened to that file. For testing releases.
#[tauri::command]
fn update_test() -> Option<String> {
    std::env::var("SLATE_UPDATE_TEST").ok()
}

#[tauri::command]
fn update_test_report(text: String) -> Result<(), String> {
    let path = std::env::var("SLATE_UPDATE_TEST").map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// A .zip with stored (uncompressed) entries.
fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let with_modes: Vec<(&str, &[u8], u32)> = files.iter().map(|(n, d)| (*n, *d, 0)).collect();
    zip_modes(&with_modes)
}

/// A zip whose entries can carry Unix permissions (mode 0 = none), so programs stay executable.
fn zip_modes(files: &[(&str, &[u8], u32)]) -> Vec<u8> {
    let (mut out, mut central) = (Vec::new(), Vec::new());
    for (name, data, mode) in files {
        let mode = *mode;
        let crc = crc32(data);
        let offset = out.len() as u32;
        let (n, size) = (name.len() as u16, data.len() as u32);
        let header = |sig: u32, central: bool| {
            let mut h = sig.to_le_bytes().to_vec();
            if central {
                // made by: Unix (3) when there are permissions to keep
                h.extend_from_slice(&(if mode != 0 { 0x0314u16 } else { 20u16 }).to_le_bytes());
            }
            h.extend_from_slice(&20u16.to_le_bytes()); // version needed
            h.extend_from_slice(&0x0800u16.to_le_bytes()); // utf-8 names
            h.extend_from_slice(&0u16.to_le_bytes()); // stored
            h.extend_from_slice(&[0, 0, 0x21, 0]); // time, date (1980-01-01)
            h.extend_from_slice(&crc.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&n.to_le_bytes());
            h.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                h.extend_from_slice(&[0; 6]); // comment length, disk, internal attributes
                h.extend_from_slice(&((mode | if mode != 0 { 0o100000 } else { 0 }) << 16).to_le_bytes()); // external attributes
                h.extend_from_slice(&offset.to_le_bytes());
            }
            h.extend_from_slice(name.as_bytes());
            h
        };
        out.extend(header(0x0403_4b50, false));
        out.extend_from_slice(data);
        central.extend(header(0x0201_4b50, true));
    }
    let (cd_offset, cd_len, count) = (out.len() as u32, central.len() as u32, files.len() as u16);
    out.extend(central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_len.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&[0; 2]);
    out
}

/// A file name from a game name (letters, digits, - and _).
fn file_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    if s.trim_matches('-').is_empty() { "game".into() } else { s }
}

/// Export a macOS game: a .zip holding Name.app (the player + Resources/game.slate, signature intact).
#[tauri::command]
fn export_macos(json: String, name: String, path: String) -> Result<u64, String> {
    if PLAYER_MACOS.is_empty() {
        return Err("this Slate build has no macOS player (it comes with the builds made by CI)".into());
    }
    let n = file_name(&name);
    let esc = name.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>{n}</string>
  <key>CFBundleIdentifier</key><string>dev.slate.game.{n}</string>
  <key>CFBundleName</key><string>{esc}</string>
  <key>CFBundleDisplayName</key><string>{esc}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>10.13</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
"#
    );
    let (exe, res, info) = (format!("{n}.app/Contents/MacOS/{n}"), format!("{n}.app/Contents/Resources/game.slate"), format!("{n}.app/Contents/Info.plist"));
    let out = zip_modes(&[(&info, plist.as_bytes(), 0o644), (&exe, PLAYER_MACOS, 0o755), (&res, json.as_bytes(), 0o644)]);
    std::fs::write(&path, &out).map_err(|e| format!("cannot write {path}: {e}"))?;
    Ok(out.len() as u64)
}

/// Export a Linux game: a .zip with the player (marked executable) and game.slate next to it.
#[tauri::command]
fn export_linux(json: String, name: String, path: String) -> Result<u64, String> {
    if PLAYER_LINUX.is_empty() {
        return Err("this Slate build has no Linux player (it comes with the builds made by CI)".into());
    }
    let n = file_name(&name);
    let (exe, cart) = (format!("{n}/{n}"), format!("{n}/game.slate"));
    let out = zip_modes(&[(&exe, PLAYER_LINUX, 0o755), (&cart, json.as_bytes(), 0o644)]);
    std::fs::write(&path, &out).map_err(|e| format!("cannot write {path}: {e}"))?;
    Ok(out.len() as u64)
}

/// Export an Android game: the shell app + the web player + game.slate, signed (.apk).
#[tauri::command]
fn export_android(json: String, name: String, title: String, path: String) -> Result<u64, String> {
    if WEB_WASM.is_empty() {
        return Err("this Slate build has no web player (Android games run it)".into());
    }
    let cart: serde_json::Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let res = &cart["resolution"];
    let portrait = res[1].as_f64().unwrap_or(0.0) > res[0].as_f64().unwrap_or(0.0);
    let mut web: Vec<(&str, &[u8])> = WEB_FILES.to_vec();
    web.push(("slate-player.wasm", WEB_WASM));
    let out = android::build_apk(&json, &name, &title, portrait, &web)?;
    std::fs::write(&path, &out).map_err(|e| format!("cannot write {path}: {e}"))?;
    Ok(out.len() as u64)
}

/// Which systems this build can export native games for.
#[tauri::command]
fn export_targets() -> Vec<&'static str> {
    [("windows", PLAYER_WINDOWS), ("macos", PLAYER_MACOS), ("linux", PLAYER_LINUX)].iter().filter(|(_, p)| !p.is_empty()).map(|(n, _)| *n).collect()
}

/// Export a browser build as a .zip (index.html at the top): upload it to itch.io as an HTML game.
#[tauri::command]
fn export_web(json: String, path: String) -> Result<u64, String> {
    if WEB_WASM.is_empty() {
        return Err("this Slate build has no web player (build it with `npm run web:build`, then rebuild the app)".into());
    }
    let mut files: Vec<(&str, &[u8])> = WEB_FILES.to_vec();
    files.push(("slate-player.wasm", WEB_WASM));
    files.push(("game.slate", json.as_bytes()));
    let out = zip(&files);
    std::fs::write(&path, &out).map_err(|e| format!("cannot write {path}: {e}"))?;
    Ok(out.len() as u64)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Runner::default())
        .invoke_handler(tauri::generate_handler![
            run_cart,
            update_cart,
            stop_cart,
            is_running,
            player_output,
            export_windows,
            export_macos,
            export_linux,
            export_targets,
            export_android,
            export_web,
            update_test,
            open_url,
            update_test_report,
            project::project_read,
            project::project_write,
            project::project_probe,
            plugins::list_plugins,
            plugins::plugins_folder,
            plugins::install_plugin,
            plugins::plugin_fetch
        ])
        .on_window_event(|window, event| {
            // closing the editor also closes the game window
            if let tauri::WindowEvent::Destroyed = event {
                use tauri::Manager;
                if let Some(state) = window.try_state::<Runner>() {
                    if let Ok(mut c) = state.0.lock() {
                        if let Some(mut child) = c.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Slate");
}

#[cfg(test)]
mod zip_tests {
    #[test]
    fn writes_a_zip() {
        let out = super::zip(&[("index.html", b"<p>hi</p>"), ("dir/game.slate", b"{}")]);
        std::fs::write(std::env::temp_dir().join("slate-zip-test.zip"), &out).unwrap();
        assert_eq!(super::crc32(b"123456789"), 0xCBF4_3926);
    }
}
