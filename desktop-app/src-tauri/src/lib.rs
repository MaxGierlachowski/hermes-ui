//! Hermes UI desktop shell (Tauri 2).
//!
//! The window shows the universal app's web build (app → `expo export -p web`). This file adds
//! what a web page cannot do on its own:
//!
//! - **Backend**: either the bundled backend as a sidecar ("everything in one app": the Node binary
//!   and `resources/server/hermes-ui.mjs`, own data dir, port 8799 by default) or a backend that is
//!   already running (URL + token). The page asks `local_backend` and talks to it over plain HTTP.
//! - **Keychain**: `secret_get/set/delete` keep the pairing (and with it the token) in the macOS
//!   Keychain instead of localStorage (service = the bundle identifier).
//! - **Native chrome**: menu bar (with the shortcuts), tray icon, closing hides to the tray, a global
//!   shortcut to show / hide the window, launch at login, window size and position remembered,
//!   system notifications, a single instance.
//! - **Links**: external links open in the default browser, never inside the window (external.rs).
//!
//! Configuration: `desktop.json` in the app's config dir; for development the same keys as env vars
//! (HERMES_UI_DESKTOP_MODE / _PORT / _URL / _TOKEN / _DATA_DIR / _SIDECAR_ARGS / _SHORTCUT).
use std::{
    fs,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    path::BaseDirectory,
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as _};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_shell::{process::CommandChild, process::CommandEvent, ShellExt};

#[cfg(target_os = "macos")]
mod macos_notify;
mod external;


#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    /// "sidecar" (start the bundled backend), "connect" (use connect_url + connect_token), "off".
    mode: String,
    port: u16,
    connect_url: Option<String>,
    connect_token: Option<String>,
    /// Extra arguments for the sidecar backend (e.g. ["--paseo", "off"]).
    sidecar_args: Vec<String>,
    /// Show / hide the window from anywhere ("" = none).
    global_shortcut: String,
    /// Where the sidecar keeps its state (default: <app data dir>/backend).
    data_dir: Option<PathBuf>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            mode: "off".into(),
            port: 8799,
            connect_url: None,
            connect_token: None,
            sidecar_args: vec![],
            global_shortcut: "Alt+Shift+H".into(),
            data_dir: None,
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct LocalBackend {
    base_url: String,
    token: String,
    managed: bool,
}

#[derive(Clone, Debug)]
enum Status {
    Off,
    Starting,
    Ready(LocalBackend),
    Failed(String),
}

struct Backend {
    config: Mutex<Config>,
    status: Mutex<Status>,
    child: Mutex<Option<CommandChild>>,
}

fn config_path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("desktop.json")
}

fn load_config(app: &AppHandle) -> Config {
    let mut c: Config = fs::read_to_string(config_path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let env = |k: &str| std::env::var(format!("HERMES_UI_DESKTOP_{k}")).ok().filter(|v| !v.is_empty());
    if let Some(v) = env("MODE") { c.mode = v }
    if let Some(v) = env("PORT").and_then(|v| v.parse().ok()) { c.port = v }
    if let Some(v) = env("URL") { c.connect_url = Some(v); if env("MODE").is_none() { c.mode = "connect".into() } }
    if let Some(v) = env("TOKEN") { c.connect_token = Some(v) }
    if let Some(v) = env("DATA_DIR") { c.data_dir = Some(PathBuf::from(v)) }
    if let Some(v) = env("SIDECAR_ARGS") { c.sidecar_args = v.split_whitespace().map(String::from).collect() }
    if let Some(v) = std::env::var("HERMES_UI_DESKTOP_SHORTCUT").ok() { c.global_shortcut = v }
    c
}

fn save_config(app: &AppHandle, c: &Config) {
    let p = config_path(app);
    let _ = fs::create_dir_all(p.parent().unwrap());
    let _ = fs::write(p, serde_json::to_string_pretty(c).unwrap_or_default());
}

/// HERMES_UI_TOKEN from the sidecar's env file, created (0600) with a random token on first use.
fn sidecar_token(env_file: &PathBuf) -> std::io::Result<String> {
    if let Ok(s) = fs::read_to_string(env_file) {
        if let Some(t) = s.lines().find_map(|l| l.strip_prefix("HERMES_UI_TOKEN=")) {
            if !t.trim().is_empty() { return Ok(t.trim().to_string()) }
        }
    }
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let mut f = fs::OpenOptions::new().create(true).append(true).open(env_file)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(env_file, fs::Permissions::from_mode(0o600));
    }
    writeln!(f, "HERMES_UI_TOKEN={token}")?;
    Ok(token)
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(150)).is_ok()
}

/// Starts the bundled backend (Node sidecar) and marks it ready once its port answers.
fn start_sidecar(app: &AppHandle) {
    let state = app.state::<Backend>();
    if matches!(*state.status.lock().unwrap(), Status::Starting | Status::Ready(_)) && state.child.lock().unwrap().is_some() {
        return;
    }
    let cfg = state.config.lock().unwrap().clone();
    *state.status.lock().unwrap() = Status::Starting;
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app2.state::<Backend>();
        let fail = |msg: String| { eprintln!("[hermes-ui] sidecar: {msg}"); *state.status.lock().unwrap() = Status::Failed(msg) };
        if port_open(cfg.port) {
            return fail(format!("port {} is already in use (another backend?). Choose another port in desktop.json or connect to that backend.", cfg.port));
        }
        let data_dir = cfg.data_dir.clone().unwrap_or_else(|| app2.path().app_data_dir().unwrap_or_default().join("backend"));
        if let Err(e) = fs::create_dir_all(&data_dir) { return fail(format!("data dir: {e}")) }
        let env_file = data_dir.join(".env");
        let token = match sidecar_token(&env_file) { Ok(t) => t, Err(e) => return fail(format!("token: {e}")) };
        let script = match app2.path().resolve("resources/server/hermes-ui.mjs", BaseDirectory::Resource) { Ok(p) => p, Err(e) => return fail(format!("backend bundle: {e}")) };
        let mut args: Vec<String> = vec![
            script.to_string_lossy().into(), "serve".into(), "--port".into(), cfg.port.to_string(),
            "--data-dir".into(), data_dir.to_string_lossy().into(), "--ui".into(), "off".into(),
        ];
        args.extend(cfg.sidecar_args.iter().cloned());
        let cmd = match app2.shell().sidecar("node") { Ok(c) => c, Err(e) => return fail(format!("node sidecar: {e}")) };
        let (mut rx, child) = match cmd.args(args).env("HERMES_UI_ENV_FILE", env_file.to_string_lossy().to_string()).spawn() {
            Ok(x) => x,
            Err(e) => return fail(format!("spawn: {e}")),
        };
        *state.child.lock().unwrap() = Some(child);
        // The backend's output goes to <data dir>/backend.log.
        let log_path = data_dir.join("backend.log");
        tauri::async_runtime::spawn(async move {
            let mut log = fs::OpenOptions::new().create(true).append(true).open(log_path).ok();
            while let Some(ev) = rx.recv().await {
                let line = match ev {
                    CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => l,
                    CommandEvent::Terminated(t) => format!("[exited: {:?}]\n", t.code).into_bytes(),
                    _ => continue,
                };
                if let Some(f) = log.as_mut() { let _ = f.write_all(&line); }
            }
        });
        let t0 = Instant::now();
        while t0.elapsed() < Duration::from_secs(20) {
            if port_open(cfg.port) {
                *state.status.lock().unwrap() = Status::Ready(LocalBackend { base_url: format!("http://127.0.0.1:{}", cfg.port), token, managed: true });
                eprintln!("[hermes-ui] sidecar ready on {} in {} ms", cfg.port, t0.elapsed().as_millis());
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        fail("the backend did not start within 20 s (see backend.log in its data dir)".into())
    });
}

fn stop_sidecar(app: &AppHandle) {
    let state = app.state::<Backend>();
    if let Some(child) = state.child.lock().unwrap().take() { let _ = child.kill(); }
    *state.status.lock().unwrap() = Status::Off;
}

fn apply_mode(app: &AppHandle) {
    let cfg = app.state::<Backend>().config.lock().unwrap().clone();
    match cfg.mode.as_str() {
        "sidecar" => start_sidecar(app),
        "connect" => {
            let status = match (cfg.connect_url, cfg.connect_token) {
                (Some(url), Some(token)) => Status::Ready(LocalBackend { base_url: url.trim_end_matches('/').into(), token, managed: false }),
                _ => Status::Failed("connect mode needs connectUrl and connectToken".into()),
            };
            stop_sidecar(app);
            *app.state::<Backend>().status.lock().unwrap() = status;
        }
        _ => stop_sidecar(app),
    }
}

/// The backend the page should use, or null (then it shows the pairing screen). Waits while the
/// sidecar is starting.
#[tauri::command]
async fn local_backend(app: AppHandle) -> Result<Option<LocalBackend>, String> {
    let t0 = Instant::now();
    loop {
        let status = app.state::<Backend>().status.lock().unwrap().clone();
        match status {
            Status::Ready(b) => return Ok(Some(b)),
            Status::Off => return Ok(None),
            Status::Failed(e) => return Err(e),
            Status::Starting if t0.elapsed() > Duration::from_secs(25) => return Err("backend start timed out".into()),
            Status::Starting => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    }
}

/// "sidecar", "connect" or "off"; remembered in desktop.json.
#[tauri::command]
async fn set_backend_mode(app: AppHandle, mode: String, url: Option<String>, token: Option<String>) -> Result<Option<LocalBackend>, String> {
    {
        let state = app.state::<Backend>();
        let mut c = state.config.lock().unwrap();
        c.mode = mode;
        if url.is_some() { c.connect_url = url }
        if token.is_some() { c.connect_token = token }
        save_config(&app, &c);
    }
    apply_mode(&app);
    local_backend(app).await
}

// Keychain items belong to the app's identifier (service = bundle identifier), so a build with
// another identifier (tests, forks) never touches them. The calls run off the main thread: while
// macOS asks for access (e.g. after a re-signed build), the window and Quit keep working.
fn entry(app: &AppHandle, key: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(&app.config().identifier, key).map_err(|e| e.to_string())
}
async fn keychain<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
  tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
  keychain(move || match entry(&app, &key)?.get_password() {
    Ok(v) => Ok(Some(v)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }).await
}
#[tauri::command]
async fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
  keychain(move || entry(&app, &key)?.set_password(&value).map_err(|e| e.to_string())).await
}
#[tauri::command]
async fn secret_delete(app: AppHandle, key: String) -> Result<(), String> {
  keychain(move || match entry(&app, &key)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }).await
}

/// Notification permission: "granted", "denied", "prompt" or "unsupported" (then the page uses the
/// notification plugin). `request`: show the system dialog if the user has not decided yet.
#[tauri::command]
async fn notification_permission(request: bool) -> String {
  #[cfg(target_os = "macos")]
  { macos_notify::permission(request).await }
  #[cfg(not(target_os = "macos"))]
  { let _ = request; "unsupported".into() }
}

/// A system notification; a click on it opens the chat (`notification-click` event). False if the
/// platform path is not available (then the page uses the notification plugin).
#[tauri::command]
fn notify(title: String, body: String, session_id: Option<String>) -> bool {
  #[cfg(target_os = "macos")]
  { macos_notify::notify(&title, &body, session_id.as_deref()) }
  #[cfg(not(target_os = "macos"))]
  { let _ = (title, body, session_id); false }
}

/// Opens the system settings page where a refused permission can be turned on again.
#[tauri::command]
fn open_privacy_settings(kind: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let url = match kind.as_str() {
      "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
      "notifications" => "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
      _ => return Err(format!("unknown permission {kind}")),
    };
    std::process::Command::new("open").arg(url).status().map(|_| ()).map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "macos"))]
  { Err(format!("not available here: {kind}")) }
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) { let _ = w.hide(); } else { show_window(app) }
    }
}
/// Forwards a menu / tray action to the page (DesktopHome handles it like the keyboard shortcut).
fn action(app: &AppHandle, id: &str) {
    show_window(app);
    let _ = app.emit("menu", id.to_string());
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, text: &str, accel: &str| MenuItemBuilder::with_id(id, text).accelerator(accel).build(app);
    let app_menu = SubmenuBuilder::new(app, "Hermes UI")
        .item(&PredefinedMenuItem::about(app, Some("About Hermes UI"), None)?)
        .separator()
        .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Quit Hermes UI").accelerator("CmdOrCtrl+Q").build(app)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("new-chat", "New Chat", "CmdOrCtrl+N")?)
        .item(&item("search", "Search…", "CmdOrCtrl+K")?)
        .separator()
        .item(&item("close", "Close Chat", "CmdOrCtrl+W")?)
        .build()?;
    // The standard Edit menu: without it ⌘C / ⌘V / ⌘A do nothing in a macOS webview.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo().redo().separator().cut().copy().paste().select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("board", "Board", "CmdOrCtrl+B")?)
        .item(&item("inbox", "Inbox", "CmdOrCtrl+I")?)
        .separator()
        .item(&item("column-1", "New Task", "CmdOrCtrl+1")?)
        .item(&item("column-2", "Doing", "CmdOrCtrl+2")?)
        .item(&item("column-3", "Waiting", "CmdOrCtrl+3")?)
        .item(&item("column-4", "Done", "CmdOrCtrl+4")?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .build()?;
    MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &window]).build()
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let autostart = CheckMenuItemBuilder::with_id("autostart", "Launch at Login")
        .checked(app.autolaunch().is_enabled().unwrap_or(false))
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&MenuItemBuilder::with_id("show", "Show Hermes UI").build(app)?)
        .item(&MenuItemBuilder::with_id("new-chat", "New Chat").build(app)?)
        .item(&MenuItemBuilder::with_id("search", "Search…").build(app)?)
        .separator()
        .item(&autostart)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Hermes UI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "show" => show_window(app),
            "quit" => app.exit(0),
            "autostart" => {
                let al = app.autolaunch();
                let on = al.is_enabled().unwrap_or(false);
                let _ = if on { al.disable() } else { al.enable() };
                let _ = autostart.set_checked(!on);
            }
            id => action(app, id),
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // First: a second launch focuses the running app instead of starting another backend.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_window(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // Links never navigate the app's webview away: external ones open in the default browser.
        .plugin(external::navigation_guard())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| { if event.state() == ShortcutState::Pressed { toggle_window(app) } })
                .build(),
        )
        // The window shows only the bundled UI: microphone (voice messages) and camera (photos) are
        // allowed for it without WebKit's own per-page prompt. macOS still asks once (TCC), with the
        // texts from Info.plist.
        .on_permission_request(|_webview, kind| match kind {
            tauri::webview::PermissionKind::Microphone | tauri::webview::PermissionKind::Camera => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![local_backend, set_backend_mode, secret_get, secret_set, secret_delete, notification_permission, notify, open_privacy_settings, external::open_external])
        .setup(|app| {
            let handle = app.handle().clone();
            // The main window is built here (not from tauri.conf.json) for its new-window handler:
            // target=_blank and window.open go to the default browser instead of being dropped.
            let main = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("no main window config")?;
            let opener = handle.clone();
            tauri::WebviewWindowBuilder::from_config(&handle, &main)?
                .on_new_window(move |url, _features| { external::new_window(&opener, &url); tauri::webview::NewWindowResponse::Deny })
                .build()?;
            let config = load_config(&handle);
            let shortcut = config.global_shortcut.clone();
            app.manage(Backend { config: Mutex::new(config), status: Mutex::new(Status::Off), child: Mutex::new(None) });
            apply_mode(&handle);
            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, ev| match ev.id().as_ref() {
                "quit" => app.exit(0),
                id => action(app, id),
            });
            build_tray(&handle)?;
            #[cfg(target_os = "macos")]
            macos_notify::install(&handle);
            // Development / screenshots: open a route at start, e.g. HERMES_UI_DESKTOP_ROUTE=/demo.
            if let Ok(route) = std::env::var("HERMES_UI_DESKTOP_ROUTE") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval(&format!("if (location.pathname !== {route:?}) {{ history.replaceState(null, '', {route:?}); location.reload() }}"));
                }
            }
            if !shortcut.is_empty() {
                match shortcut.parse::<Shortcut>() {
                    Ok(s) => { if let Err(e) = app.global_shortcut().register(s) { eprintln!("[hermes-ui] global shortcut {shortcut}: {e}") } }
                    Err(e) => eprintln!("[hermes-ui] global shortcut {shortcut}: {e}"),
                }
            }
            Ok(())
        })
        // Closing the window keeps the app (and its notifications) running in the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the Hermes UI desktop app");

    app.run(|app, event| match event {
        // Dock icon clicked while the window is hidden.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_window(app),
        RunEvent::Exit => stop_sidecar(app),
        _ => {}
    });
}
