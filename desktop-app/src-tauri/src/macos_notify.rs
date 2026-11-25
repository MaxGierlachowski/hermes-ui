//! System notifications through `UNUserNotificationCenter` (macOS).
//!
//! The notification plugin's desktop backend uses the deprecated NSUserNotification API and reports
//! "granted" without ever asking, so macOS never showed its permission dialog. Here the app asks
//! properly (the system dialog appears on the first request), sends through the same centre, and a
//! click on a notification opens its chat (event `notification-click` with the session id).
//!
//! `UNUserNotificationCenter` needs a real app bundle; a bare binary (`cargo run`) gets "unsupported"
//! and the page falls back to the notification plugin.
use std::sync::{
  atomic::{AtomicU64, Ordering},
  Mutex,
};

use block2::RcBlock;
use objc2::{define_class, msg_send, rc::Retained, runtime::{Bool, ProtocolObject}, AllocAnyThread, DefinedClass};
use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
  UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
  UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
  UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Manager};

const PREFIX: &str = "hermes|";
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// Inside `Something.app/Contents/MacOS/`? Otherwise the notification centre throws.
pub fn bundled() -> bool {
  std::env::current_exe().map(|p| p.to_string_lossy().contains(".app/Contents/MacOS/")).unwrap_or(false)
}

pub struct Ivars {
  app: AppHandle,
}

define_class!(
  #[unsafe(super(NSObject))]
  #[name = "HermesUINotificationDelegate"]
  #[ivars = Ivars]
  struct Delegate;

  unsafe impl NSObjectProtocol for Delegate {}

  unsafe impl UNUserNotificationCenterDelegate for Delegate {
    // In the foreground too (the page only notifies when the window is not focused).
    #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
    fn will_present(
      &self,
      _center: &UNUserNotificationCenter,
      _notification: &UNNotification,
      handler: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
    ) {
      handler.call((UNNotificationPresentationOptions::Banner | UNNotificationPresentationOptions::List,));
    }

    #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
    fn did_receive(
      &self,
      _center: &UNUserNotificationCenter,
      response: &UNNotificationResponse,
      handler: &block2::DynBlock<dyn Fn()>,
    ) {
      let id = response.notification().request().identifier().to_string();
      let session = id.strip_prefix(PREFIX).and_then(|rest| rest.rsplit_once('|')).map(|(s, _)| s.to_string()).unwrap_or_default();
      let app = &self.ivars().app;
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
      }
      let _ = app.emit("notification-click", session);
      handler.call(());
    }
  }
);

/// Sets the delegate once (the centre keeps only a weak reference, so it is leaked on purpose).
pub fn install(app: &AppHandle) {
  if !bundled() {
    return;
  }
  let this = Delegate::alloc().set_ivars(Ivars { app: app.clone() });
  let delegate: Retained<Delegate> = unsafe { msg_send![super(this), init] };
  let center = UNUserNotificationCenter::currentNotificationCenter();
  center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
  std::mem::forget(delegate);
}

fn status_name(s: UNAuthorizationStatus) -> &'static str {
  match s {
    UNAuthorizationStatus::Authorized | UNAuthorizationStatus::Provisional | UNAuthorizationStatus::Ephemeral => "granted",
    UNAuthorizationStatus::Denied => "denied",
    _ => "prompt",
  }
}

/// "granted", "denied" or "prompt"; with `request` the system dialog appears if not decided yet.
pub async fn permission(request: bool) -> String {
  if !bundled() {
    return "unsupported".into();
  }
  if request {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
      let tx = Mutex::new(Some(tx));
      let block = RcBlock::new(move |_granted: Bool, _err: *mut NSError| {
        if let Some(t) = tx.lock().unwrap().take() { let _ = t.send(()); }
      });
      UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge, &block);
    }
    let _ = rx.await;
  }
  let (tx, rx) = tokio::sync::oneshot::channel::<&'static str>();
  {
    let tx = Mutex::new(Some(tx));
    let block = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
      let status = unsafe { settings.as_ref() }.authorizationStatus();
      if let Some(t) = tx.lock().unwrap().take() { let _ = t.send(status_name(status)); }
    });
    UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&block);
  }
  rx.await.unwrap_or("prompt").to_string()
}

/// Shows a notification now; a click on it emits `notification-click` with `session`.
pub fn notify(title: &str, body: &str, session: Option<&str>) -> bool {
  if !bundled() {
    return false;
  }
  let content = UNMutableNotificationContent::new();
  content.setTitle(&NSString::from_str(title));
  content.setBody(&NSString::from_str(body));
  let id = format!("{PREFIX}{}|{}", session.unwrap_or(""), COUNTER.fetch_add(1, Ordering::Relaxed));
  let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&NSString::from_str(&id), &content, None);
  UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
  true
}
