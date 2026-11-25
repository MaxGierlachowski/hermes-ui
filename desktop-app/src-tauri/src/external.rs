//! Links that leave the app (NACHTRAG external links). The window shows only the bundled UI; every
//! other http(s) / mailto: target opens in the default browser or mail app, everything else is
//! dropped. Same rules as `app/src/lib/links.ts`, applied to:
//!
//! - `open_external` (the page's `openExternal`, e.g. Markdown links and "Open image"),
//! - navigations of the main webview (a link that would replace the app), and
//! - new-window requests (`target=_blank`, `window.open`), which WKWebView otherwise drops silently.
//!
//! Opening goes through tauri-plugin-opener's Rust API; the page itself gets no opener permission.
use tauri::{plugin::TauriPlugin, AppHandle, Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum LinkKind {
    Internal,
    External,
    Blocked,
}

/// The bundled UI's origins (macOS / Linux use tauri://localhost, Windows http(s)://tauri.localhost),
/// plus the Expo dev server while developing.
fn is_app_origin(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost")) if cfg!(dev) => url.port() == Some(8081),
        _ => false,
    }
}

pub fn classify(url: &Url) -> LinkKind {
    if is_app_origin(url) {
        return LinkKind::Internal;
    }
    match url.scheme() {
        // The webview's own internals (initial blank page, IPC) are not links.
        "about" | "ipc" | "asset" => LinkKind::Internal,
        "http" | "https" | "mailto" => LinkKind::External,
        _ => LinkKind::Blocked,
    }
}

fn open<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    match app.opener().open_url(url.as_str(), None::<&str>) {
        Ok(()) => true,
        Err(e) => { eprintln!("[hermes-ui] open {url}: {e}"); false }
    }
}

/// `openExternal(url)` from the page: only http(s) and mailto: (no files, no custom schemes).
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    let url = Url::parse(&url).map_err(|e| e.to_string())?;
    match classify(&url) {
        LinkKind::External => Ok(open(&app, &url)),
        _ => Err(format!("not an external link: {}", url.scheme())),
    }
}

/// Navigations of any webview: the app's own pages load, external links open outside, the rest stops.
pub fn navigation_guard<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("external-links")
        .on_navigation(|webview, url| match classify(url) {
            LinkKind::Internal => true,
            LinkKind::External => { open(webview.app_handle(), url); false }
            LinkKind::Blocked => false,
        })
        .build()
}

/// For the main window's `on_new_window`: never a second webview window.
pub fn new_window<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if classify(url) == LinkKind::External {
        open(app, url);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn kind(s: &str) -> LinkKind { classify(&Url::parse(s).unwrap()) }

    #[test]
    fn app_pages_stay_inside() {
        assert_eq!(kind("tauri://localhost/"), LinkKind::Internal);
        assert_eq!(kind("tauri://localhost/thread/abc?x=1#m"), LinkKind::Internal);
        assert_eq!(kind("http://tauri.localhost/index.html"), LinkKind::Internal);
        assert_eq!(kind("about:blank"), LinkKind::Internal);
    }

    #[test]
    fn web_and_mail_open_outside() {
        assert_eq!(kind("https://github.com/MaxGierlachowski/hermes-ui/pull/12"), LinkKind::External);
        assert_eq!(kind("http://example.com"), LinkKind::External);
        assert_eq!(kind("http://127.0.0.1:8787/api/file?path=x"), LinkKind::External);
        assert_eq!(kind("mailto:someone@example.com"), LinkKind::External);
    }

    #[test]
    fn everything_else_is_blocked() {
        assert_eq!(kind("javascript:alert(1)"), LinkKind::Blocked);
        assert_eq!(kind("file:///etc/passwd"), LinkKind::Blocked);
        assert_eq!(kind("data:text/html,<b>x</b>"), LinkKind::Blocked);
        assert_eq!(kind("tauri://evil/"), LinkKind::Blocked);
        assert_eq!(kind("vscode://file/x"), LinkKind::Blocked);
        assert_eq!(kind("tel:+49123"), LinkKind::Blocked);
    }
}
