//! Files from chats (the page's file preview, app/src/lib/files.web.ts):
//!
//! - `save_download`: the bytes of a download (raw IPC body, name in the `x-file-name` header) into the
//!   Downloads folder, never overwriting ("report (1).pdf"); returns the path.
//! - `open_local_file`: "Open in system" for a file on this machine (only when the backend runs here):
//!   opens it with its default app. Only regular files that are not programs or scripts; the backend
//!   has already checked that the chat may show the file (server/src/file-access.mjs).
use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;

/// One safe path component: no separators or control characters, no leading dot, at most 200 chars.
pub fn safe_name(raw: &str) -> String {
    let name: String = raw.chars().map(|c| if c == '/' || c == '\\' || c == ':' || c.is_control() { '_' } else { c }).collect();
    let name = name.trim().trim_start_matches('.').trim();
    if name.is_empty() { "download".into() } else { name.chars().take(200).collect() }
}

/// `dir/name`, or `dir/stem (n).ext` with the first n that is free.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

/// %XX decoding of the header value (the page sends encodeURIComponent(name): headers are ASCII).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub async fn save_download(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected the file as raw bytes".into()) };
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique_path(&dir, &safe_name(&name));
    fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Programs, scripts, installers and link files: opening them would run something.
const NEVER_OPEN: &[&str] = &[
    "app", "command", "tool", "sh", "bash", "zsh", "csh", "fish", "py", "rb", "pl", "php", "js", "mjs", "jar", "scpt", "scptd",
    "applescript", "workflow", "action", "terminal", "pkg", "mpkg", "dmg", "exe", "bat", "cmd", "com", "msi", "ps1", "vbs",
    "lnk", "url", "webloc", "inetloc", "fileloc", "desktop", "appimage", "deb", "rpm", "prefpane", "kext", "plugin", "bundle",
];

/// Why a path must not be opened, or None.
pub fn refuse_open(path: &Path) -> Option<&'static str> {
    if !path.is_absolute() {
        return Some("not an absolute path");
    }
    let meta = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return Some("not found"),
    };
    if !meta.is_file() {
        return Some("not a file");
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if NEVER_OPEN.contains(&ext.as_str()) {
        return Some("programs and scripts are not opened");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 != 0 {
            return Some("executable files are not opened");
        }
    }
    None
}

#[tauri::command]
pub fn open_local_file(app: AppHandle, path: String) -> Result<(), String> {
    let file = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if let Some(why) = refuse_open(&file) {
        return Err(why.into());
    }
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stay_one_component() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name(".env"), "env");
        assert_eq!(safe_name("  "), "download");
        assert_eq!(safe_name("Übersicht Q3.pdf"), "Übersicht Q3.pdf");
    }

    #[test]
    fn decodes_header_names() {
        assert_eq!(percent_decode("%C3%9Cbersicht%20Q3.pdf"), "Übersicht Q3.pdf");
        assert_eq!(percent_decode("a%2"), "a%2");
    }

    #[test]
    fn never_overwrites() {
        let dir = std::env::temp_dir().join(format!("hermes-ui-files-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("r.pdf"), "x").unwrap();
        fs::write(dir.join("r (1).pdf"), "x").unwrap();
        assert_eq!(unique_path(&dir, "r.pdf"), dir.join("r (2).pdf"));
        assert_eq!(unique_path(&dir, "new.txt"), dir.join("new.txt"));
        fs::write(dir.join("run.sh"), "x").unwrap();
        assert!(refuse_open(&dir.join("run.sh")).is_some());
        assert!(refuse_open(&dir.join("r.pdf")).is_none());
        assert!(refuse_open(&dir).is_some());
        fs::remove_dir_all(&dir).unwrap();
    }
}
