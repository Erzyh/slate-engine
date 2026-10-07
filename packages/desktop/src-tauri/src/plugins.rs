// Editor plugins: discovery, installation, and a network proxy that only lets a plugin reach
// the hosts its plugin.json declares (checked here again, independently of the editor UI).

use base64::Engine as _;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize)]
pub struct Found {
    manifest: String,
    source: String,
    dir: String,
}

#[derive(Serialize)]
pub struct FetchResult {
    status: u16,
    /// base64
    body: String,
}

/// Installed plugins live in <app data>/plugins; SLATE_PLUGINS adds extra folders (dev).
pub fn plugin_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = vec![];
    if let Ok(d) = app.path().app_data_dir() {
        dirs.push(d.join("plugins"));
    }
    if let Some(extra) = std::env::var_os("SLATE_PLUGINS") {
        dirs.extend(std::env::split_paths(&extra));
    }
    dirs
}

fn read_plugin(dir: &Path) -> Option<(serde_json::Value, String, String)> {
    let manifest = std::fs::read_to_string(dir.join("plugin.json")).ok()?;
    let m: serde_json::Value = serde_json::from_str(&manifest).ok()?;
    let entry = m.get("entry")?.as_str()?;
    // the entry must stay inside the plugin folder
    if entry.contains("..") || Path::new(entry).is_absolute() {
        return None;
    }
    let source = std::fs::read_to_string(dir.join(entry)).ok()?;
    Some((m, manifest, source))
}

fn all_plugins(app: &tauri::AppHandle) -> Vec<(PathBuf, serde_json::Value, String, String)> {
    let mut out = vec![];
    for root in plugin_dirs(app) {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.flatten() {
            if let Some((m, manifest, source)) = read_plugin(&e.path()) {
                out.push((e.path(), m, manifest, source));
            }
        }
    }
    out
}

#[tauri::command]
pub fn list_plugins(app: tauri::AppHandle) -> Vec<Found> {
    all_plugins(&app)
        .into_iter()
        .map(|(dir, _, manifest, source)| Found { manifest, source, dir: dir.display().to_string() })
        .collect()
}

#[tauri::command]
pub fn plugins_folder(app: tauri::AppHandle) -> Result<String, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("plugins");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.display().to_string())
}

/// Copy a plugin folder (containing plugin.json) into the plugins directory.
#[tauri::command]
pub fn install_plugin(app: tauri::AppHandle, src: String) -> Result<String, String> {
    let src = PathBuf::from(src);
    let (m, _, _) = read_plugin(&src).ok_or("not a Slate plugin folder (plugin.json + entry file)")?;
    let id = m.get("id").and_then(|v| v.as_str()).ok_or("plugin.json has no id")?;
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("invalid plugin id".into());
    }
    let dst = PathBuf::from(plugins_folder(app)?).join(id);
    let _ = std::fs::remove_dir_all(&dst);
    copy_dir(&src, &dst).map_err(|e| e.to_string())?;
    Ok(id.to_string())
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let to = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir(&e.path(), &to)?;
        } else {
            std::fs::copy(e.path(), to)?;
        }
    }
    Ok(())
}

fn host_port(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority.rsplit('@').next()?; // drop credentials
    if authority.contains(':') {
        Some(authority.to_string())
    } else {
        Some(format!("{authority}:{}", if scheme == "https" { 443 } else { 80 }))
    }
}

#[tauri::command]
pub async fn plugin_fetch(
    app: tauri::AppHandle,
    plugin: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<FetchResult, String> {
    let (_, m, _, _) = all_plugins(&app)
        .into_iter()
        .find(|(_, m, _, _)| m.get("id").and_then(|v| v.as_str()) == Some(plugin.as_str()))
        .ok_or("unknown plugin")?;
    let host = host_port(&url).ok_or("bad url")?;
    let allowed = m
        .pointer("/permissions/network")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().any(|h| h.as_str() == Some(host.as_str())))
        .unwrap_or(false);
    if !allowed {
        return Err(format!("plugin \"{plugin}\" is not allowed to access {host}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut req = ureq::request(&method, &url);
        for (k, v) in &headers {
            req = req.set(k, v);
        }
        let resp = match body {
            Some(b) => req.send_string(&b),
            None => req.call(),
        };
        let resp = match resp {
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("network error: {e}")),
        };
        let status = resp.status();
        let mut buf = vec![];
        std::io::Read::read_to_end(&mut resp.into_reader(), &mut buf).map_err(|e| e.to_string())?;
        Ok(FetchResult { status, body: base64::engine::general_purpose::STANDARD.encode(buf) })
    })
    .await
    .map_err(|e| e.to_string())?
}
