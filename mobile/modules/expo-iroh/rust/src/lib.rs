//! iroh-fetch for React Native.
//!
//! A thin UniFFI layer over iroh-bridge's `client-core`, the iroh-http/1 client that the iroh-fetch
//! WASM build and its Node.js addon share. It speaks exactly the protocol of `iroh-gateway`, so the
//! backend stays unchanged. Unlike the browser build it runs on iroh's native preset: real UDP
//! sockets, address publishing and lookup, so a phone hole-punches a direct path to the gateway and
//! uses the relay only until then (or when that fails).
//!
//! Kotlin (Android) and Swift (iOS) get generated bindings; the Expo module wraps them for JS.
//! Every call runs on one shared multi-threaded Tokio runtime owned by this library, so the
//! foreign side never needs to know about Tokio.

use std::{
    future::Future,
    sync::{Arc, LazyLock},
    time::Duration,
};

use client_core::{Body, Client, Options, Profile, RequestHead, ResponseBody};
use tokio::{
    io::AsyncWriteExt,
    sync::{Mutex, watch},
};

uniffi::setup_scaffolding!();

static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_name("iroh")
        .enable_all()
        .build()
        .expect("tokio runtime")
});

/// Runs `fut` on the library's runtime and waits for it from whatever executor the binding uses.
async fn on_runtime<T: Send + 'static>(fut: impl Future<Output = Result<T, IrohError>> + Send + 'static) -> Result<T, IrohError> {
    RUNTIME.spawn(fut).await.map_err(|e| IrohError::Failed(format!("task failed: {e}")))?
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum IrohError {
    #[error("{0}")]
    Failed(String),
    #[error("timed out after {0} ms")]
    Timeout(u64),
}

impl From<anyhow::Error> for IrohError {
    fn from(e: anyhow::Error) -> Self {
        IrohError::Failed(format!("{e:#}"))
    }
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct Header {
    pub name: String,
    pub value: String,
}

fn pairs(headers: Vec<Header>) -> Vec<(String, String)> {
    headers.into_iter().map(|h| (h.name, h.value)).collect()
}

fn records(headers: Vec<(String, String)>) -> Vec<Header> {
    headers.into_iter().map(|(name, value)| Header { name, value }).collect()
}

/// One local iroh endpoint that can talk to any number of gateways (one connection each).
#[derive(uniffi::Object)]
pub struct IrohClient {
    inner: Arc<Client>,
}

#[uniffi::export]
impl IrohClient {
    /// `relay_url`: comma-separated relay URLs (`n0` = n0's public relays; empty = n0's relays).
    /// `secret_key`: 64 hex chars; without it a new identity is generated (read it back with
    /// `secret_key()` and keep it in the platform keystore so the endpoint id stays stable).
    #[uniffi::constructor]
    pub async fn create(relay_url: Option<String>, relay_token: Option<String>, secret_key: Option<String>) -> Result<Arc<Self>, IrohError> {
        on_runtime(async move {
            let client = Client::create(Profile::Native, Options { relay_url, relay_token, secret_key }).await?;
            Ok(Arc::new(Self { inner: Arc::new(client) }))
        })
        .await
    }

    /// This client's endpoint id (what the gateway allow-lists after pairing).
    pub fn endpoint_id(&self) -> String {
        self.inner.endpoint_id()
    }

    /// This client's secret key as hex. Whoever has it can act as this device.
    pub fn secret_key(&self) -> String {
        self.inner.secret_key()
    }

    /// Why the home relay can't be used, if it can't.
    pub fn relay_problem(&self) -> Option<String> {
        self.inner.relay_problem()
    }

    /// JSON `{ kind: "direct" | "relay" | "none", paths: [{ kind, addr, selected, rttMs }] }`, or
    /// `None` without a connection to `remote`.
    pub fn connection_info(&self, remote: String) -> Result<Option<String>, IrohError> {
        let info = self.inner.connection_info(&remote)?;
        Ok(info.map(|i| serde_json::to_string(&i).unwrap_or_default()))
    }

    /// Dials `remote` now instead of on the first request.
    pub async fn connect(&self, remote: String, relay: Option<String>, timeout_ms: u64) -> Result<(), IrohError> {
        let client = self.inner.clone();
        on_runtime(with_timeout(timeout_ms, async move { Ok(client.connect(&remote, relay.as_deref()).await?) })).await
    }

    /// Sends one HTTP request; resolves once the response head arrived. The body uploads meanwhile.
    /// `timeout_ms` (0 = none) bounds the time until the head arrives, not the body.
    #[allow(clippy::too_many_arguments)]
    pub async fn request(
        &self,
        remote: String,
        relay: Option<String>,
        method: String,
        path: String,
        headers: Vec<Header>,
        body: Vec<u8>,
        timeout_ms: u64,
    ) -> Result<Arc<IrohResponse>, IrohError> {
        let client = self.inner.clone();
        on_runtime(with_timeout(timeout_ms, async move {
            let head = RequestHead { method, path, headers: pairs(headers), websocket: false };
            let (resp, body) = client.request(&remote, relay.as_deref(), head, Body::Bytes(body)).await?;
            Ok(Arc::new(IrohResponse::new(resp, body)))
        }))
        .await
    }

    /// GETs `path` and writes the body to `dest` (images, audio: the UI shows local files).
    /// Returns the response head; the file is only complete when the status is 2xx.
    pub async fn download(
        &self,
        remote: String,
        relay: Option<String>,
        path: String,
        headers: Vec<Header>,
        dest: String,
        timeout_ms: u64,
    ) -> Result<ResponseInfo, IrohError> {
        let client = self.inner.clone();
        on_runtime(with_timeout(timeout_ms, async move {
            let head = RequestHead { method: "GET".into(), path, headers: pairs(headers), websocket: false };
            let (resp, mut body) = client.request(&remote, relay.as_deref(), head, Body::Bytes(Vec::new())).await?;
            let info = ResponseInfo { status: resp.status, headers: records(resp.headers) };
            if (200..300).contains(&info.status) {
                let tmp = format!("{dest}.part");
                let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| IrohError::Failed(format!("{tmp}: {e}")))?;
                while let Some(chunk) = body.next_chunk().await? {
                    file.write_all(&chunk).await.map_err(|e| IrohError::Failed(e.to_string()))?;
                }
                file.flush().await.map_err(|e| IrohError::Failed(e.to_string()))?;
                tokio::fs::rename(&tmp, &dest).await.map_err(|e| IrohError::Failed(e.to_string()))?;
            } else {
                body.cancel();
            }
            Ok(info)
        }))
        .await
    }

    /// Closes all connections and the local endpoint (not `close`: that is the bindings' destructor).
    pub async fn shutdown(&self) {
        let client = self.inner.clone();
        let _ = on_runtime(async move {
            client.close().await;
            Ok(())
        })
        .await;
    }
}

async fn with_timeout<T>(ms: u64, fut: impl Future<Output = Result<T, IrohError>>) -> Result<T, IrohError> {
    if ms == 0 {
        return fut.await;
    }
    tokio::time::timeout(Duration::from_millis(ms), fut).await.unwrap_or(Err(IrohError::Timeout(ms)))
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct ResponseInfo {
    pub status: u16,
    pub headers: Vec<Header>,
}

/// A response head plus its streamed body. Dropping it (or `cancel()`) tells the gateway to stop.
#[derive(uniffi::Object)]
pub struct IrohResponse {
    info: ResponseInfo,
    body: Arc<Mutex<ResponseBody>>,
    cancelled: watch::Sender<bool>,
}

impl IrohResponse {
    fn new(head: client_core::ResponseHead, body: ResponseBody) -> Self {
        Self {
            info: ResponseInfo { status: head.status, headers: records(head.headers) },
            body: Arc::new(Mutex::new(body)),
            cancelled: watch::Sender::new(false),
        }
    }
}

#[uniffi::export]
impl IrohResponse {
    pub fn status(&self) -> u16 {
        self.info.status
    }

    pub fn headers(&self) -> Vec<Header> {
        self.info.headers.clone()
    }

    /// The next body chunk (at most 64 KiB), or `None` at the end or after `cancel()`.
    pub async fn read(&self) -> Result<Option<Vec<u8>>, IrohError> {
        let body = self.body.clone();
        let mut cancelled = self.cancelled.subscribe();
        on_runtime(async move {
            let mut body = body.lock().await;
            if *cancelled.borrow() {
                body.cancel();
                return Ok(None);
            }
            tokio::select! {
                chunk = body.next_chunk() => Ok(chunk?.map(|b| b.to_vec())),
                _ = cancelled.wait_for(|c| *c) => {
                    body.cancel();
                    Ok(None)
                }
            }
        })
        .await
    }

    /// The whole remaining body (small JSON responses).
    pub async fn bytes(&self) -> Result<Vec<u8>, IrohError> {
        let body = self.body.clone();
        on_runtime(async move {
            let mut body = body.lock().await;
            let mut out = Vec::new();
            while let Some(chunk) = body.next_chunk().await? {
                out.extend_from_slice(&chunk);
            }
            Ok(out)
        })
        .await
    }

    /// Stops the transfer; a pending `read()` resolves to `None`.
    pub fn cancel(&self) {
        self.cancelled.send_replace(true);
        if let Ok(mut body) = self.body.try_lock() {
            body.cancel();
        }
    }
}

/// Library version plus the iroh-bridge protocol it speaks, for the app's about screen.
#[uniffi::export]
pub fn library_info() -> String {
    format!("hermes-iroh {} · iroh-bridge v0.6.3 (iroh-http/1) · iroh 1.4.1", env!("CARGO_PKG_VERSION"))
}
