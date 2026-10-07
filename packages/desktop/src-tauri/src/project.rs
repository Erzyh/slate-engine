// Project folders: read every project file, write the changed ones.
// Only slate.json and files under scripts/ sprites/ maps/ music/ sounds/ are touched; paths can
// never leave the project folder. Deleted files are moved to .slate-trash/ (not destroyed).

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const FOLDERS: [&str; 5] = ["scripts", "sprites", "maps", "music", "sounds"];

#[derive(Serialize, Deserialize)]
pub struct ProjFile {
    pub path: String,
    pub b64: String,
}

#[derive(Serialize)]
pub struct Listing {
    pub files: Vec<ProjFile>,
    pub dirs: Vec<String>,
}

/// "scripts/enemies/beetle.luau" -> <dir>/scripts/enemies/beetle.luau, or an error if it is not a project path.
fn project_path(dir: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    let parts: Vec<&str> = rel.split('/').collect();
    let ok = !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains(':')
        && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != "..")
        && (rel == "slate.json" || FOLDERS.contains(&parts[0]));
    if !ok {
        return Err(format!("not a project path: {rel}"));
    }
    Ok(parts.iter().fold(dir.to_path_buf(), |p, s| p.join(s)))
}

fn walk(dir: &Path, rel: &str, files: &mut Vec<ProjFile>, dirs: &mut Vec<String>) -> Result<(), String> {
    let here = if rel.is_empty() { dir.to_path_buf() } else { dir.join(rel) };
    for e in std::fs::read_dir(&here).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        let p = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let top = p.split('/').next().unwrap_or("");
        if p != "slate.json" && !FOLDERS.contains(&top) {
            continue;
        }
        let ft = e.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            dirs.push(p.clone());
            walk(dir, &p, files, dirs)?;
        } else if ft.is_file() {
            let bytes = std::fs::read(e.path()).map_err(|e| format!("{p}: {e}"))?;
            files.push(ProjFile { path: p, b64: base64::engine::general_purpose::STANDARD.encode(bytes) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn project_read(dir: String) -> Result<Listing, String> {
    let root = PathBuf::from(&dir);
    if !root.join("slate.json").is_file() {
        return Err(format!("{dir} is not a Slate project (no slate.json)"));
    }
    let (mut files, mut dirs) = (vec![], vec![]);
    walk(&root, "", &mut files, &mut dirs)?;
    Ok(Listing { files, dirs })
}

#[tauri::command]
pub fn project_write(dir: String, files: Vec<ProjFile>, remove: Vec<String>, dirs: Vec<String>) -> Result<(), String> {
    let root = PathBuf::from(&dir);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    for d in &dirs {
        std::fs::create_dir_all(project_path(&root, d)?).map_err(|e| format!("{d}: {e}"))?;
    }
    for f in &files {
        let p = project_path(&root, &f.path)?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&f.b64).map_err(|e| format!("{}: {e}", f.path))?;
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // write next to it, then swap in: a crash never leaves a half-written file
        let tmp = p.with_extension("slate-tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| format!("{}: {e}", f.path))?;
        std::fs::rename(&tmp, &p).map_err(|e| format!("{}: {e}", f.path))?;
    }
    if !remove.is_empty() {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let trash = root.join(".slate-trash").join(stamp.to_string());
        for r in &remove {
            let p = project_path(&root, r)?;
            if !p.exists() {
                continue;
            }
            let dest = r.split('/').fold(trash.clone(), |a, s| a.join(s));
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::rename(&p, &dest).map_err(|e| format!("{r}: {e}"))?;
        }
    }
    Ok(())
}

/// Is this folder a Slate project, an empty folder (fine for "Save as"), or something else?
#[tauri::command]
pub fn project_probe(dir: String) -> String {
    let root = PathBuf::from(&dir);
    if root.join("slate.json").is_file() {
        "project".into()
    } else if std::fs::read_dir(&root).map(|mut d| d.next().is_none()).unwrap_or(true) {
        "empty".into()
    } else {
        "other".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("slate-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn f(path: &str, text: &str) -> ProjFile {
        ProjFile { path: path.into(), b64: base64::engine::general_purpose::STANDARD.encode(text) }
    }

    #[test]
    fn write_read_trash() {
        let d = tmp("rw");
        let dir = d.to_string_lossy().to_string();
        project_write(dir.clone(), vec![f("slate.json", "{}"), f("scripts/a/b.luau", "x"), f("sprites/s.png", "png")], vec![], vec!["sounds".into()]).unwrap();
        std::fs::write(d.join("notes.txt"), "not part of the project").unwrap();
        let l = project_read(dir.clone()).unwrap();
        let mut paths: Vec<_> = l.files.iter().map(|f| f.path.clone()).collect();
        paths.sort();
        assert_eq!(paths, ["scripts/a/b.luau", "slate.json", "sprites/s.png"]);
        assert!(l.dirs.contains(&"sounds".to_string()) && l.dirs.contains(&"scripts/a".to_string()));
        // delete -> moved to .slate-trash, not destroyed
        project_write(dir.clone(), vec![], vec!["scripts/a/b.luau".into()], vec![]).unwrap();
        assert!(!d.join("scripts/a/b.luau").exists());
        let trash = std::fs::read_dir(d.join(".slate-trash")).unwrap().next().unwrap().unwrap().path();
        assert_eq!(std::fs::read_to_string(trash.join("scripts/a/b.luau")).unwrap(), "x");
        assert_eq!(project_probe(dir), "project");
    }

    #[test]
    fn paths_stay_inside() {
        let d = tmp("safe");
        let dir = d.to_string_lossy().to_string();
        for bad in ["../evil.luau", "scripts/../../evil", "C:/Windows/x", "/etc/passwd", "notes.txt", "scripts//x", ""] {
            assert!(project_write(dir.clone(), vec![f(bad, "x")], vec![], vec![]).is_err(), "{bad} should be refused");
        }
        assert!(project_write(dir.clone(), vec![], vec!["../outside".into()], vec![]).is_err());
        assert_eq!(project_probe(dir), "empty");
    }
}
