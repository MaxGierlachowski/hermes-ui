//! End-to-end check against a running hermes-ui backend in iroh mode (never runs by default).
//!
//!   HERMES_IROH_ENDPOINT=<gateway endpoint id> [HERMES_IROH_RELAY=<relay url>] \
//!   [HERMES_IROH_PAIR=<one-time code>] [HERMES_IROH_KEY_FILE=/tmp/key] \
//!   cargo test --release --test e2e -- --ignored --nocapture
//!
//! Pairs (if a code is given), then: /api/health, /api/sessions, 20 timed requests (p50/p90),
//! the SSE stream /api/events for a few seconds, and the connection path (direct vs relay).

use std::time::{Duration, Instant};

use hermes_iroh::{Header, IrohClient};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn backend_over_iroh() {
    let remote = env("HERMES_IROH_ENDPOINT").expect("HERMES_IROH_ENDPOINT");
    let relay = env("HERMES_IROH_RELAY");
    let key_file = env("HERMES_IROH_KEY_FILE");
    let key = key_file.as_ref().and_then(|f| std::fs::read_to_string(f).ok());

    let t0 = Instant::now();
    let client = IrohClient::create(None, None, key).await.expect("create");
    println!("client {} (created in {:?})", client.endpoint_id(), t0.elapsed());
    if let Some(f) = &key_file {
        std::fs::write(f, client.secret_key()).unwrap();
    }

    let t1 = Instant::now();
    client.connect(remote.clone(), relay.clone(), 20_000).await.expect("connect");
    println!("connected in {:?}", t1.elapsed());

    let json = vec![Header { name: "content-type".into(), value: "application/json".into() }];
    if let Some(code) = env("HERMES_IROH_PAIR") {
        let body = format!(r#"{{"code":"{code}","name":"expo-iroh e2e"}}"#).into_bytes();
        let r = client.request(remote.clone(), relay.clone(), "POST".into(), "/api/pair/redeem".into(), json.clone(), body, 15_000).await.expect("redeem");
        let text = String::from_utf8(r.bytes().await.unwrap()).unwrap();
        println!("pair/redeem -> {} {text}", r.status());
        assert_eq!(r.status(), 200);
    }

    let r = client.request(remote.clone(), relay.clone(), "GET".into(), "/api/health".into(), vec![], vec![], 15_000).await.expect("health");
    println!("health -> {} {}", r.status(), String::from_utf8_lossy(&r.bytes().await.unwrap()));

    let r = client.request(remote.clone(), relay.clone(), "GET".into(), "/api/sessions?days=3".into(), vec![], vec![], 15_000).await.expect("sessions");
    let body = r.bytes().await.unwrap();
    println!("sessions -> {} ({} bytes)", r.status(), body.len());
    assert_eq!(r.status(), 200);

    let mut ms = Vec::new();
    for _ in 0..20 {
        let t = Instant::now();
        let r = client.request(remote.clone(), relay.clone(), "GET".into(), "/api/health".into(), vec![], vec![], 15_000).await.unwrap();
        r.bytes().await.unwrap();
        ms.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("latency p50 {:.1} ms, p90 {:.1} ms", ms[10], ms[18]);
    println!("path {}", client.connection_info(remote.clone()).unwrap().unwrap_or_default());

    let r = client.request(remote.clone(), relay.clone(), "GET".into(), "/api/events".into(), vec![], vec![], 15_000).await.expect("events");
    println!("events -> {}", r.status());
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut events = 0;
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(500), r.read()).await {
            Ok(Ok(Some(chunk))) => events += String::from_utf8_lossy(&chunk).matches("\nevent:").count() + usize::from(chunk.starts_with(b"event:")),
            Ok(_) => break,
            Err(_) => {}
        }
    }
    r.cancel();
    println!("events received in 4 s: {events}");
    client.shutdown().await;
}
