use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use log::{error, info};
use tauri::{Manager, RunEvent};

/// 離線版三程序（arangod / backend / node）的 Child handle，Exit 時清理。
struct OfflineProcesses(Mutex<Vec<Child>>);

/// 資源路徑：與 tauri.offline.conf.json 的 bundle.resources 對應（相對於 src-tauri）。
fn resource_paths(resources: &Path) -> (PathBuf, PathBuf, PathBuf, PathBuf) {
    (
        resources.join("resources/arangodb/ArangoDB3-3.11.14_win64/usr/bin/arangod.exe"),
        resources.join("resources/arangodb/ArangoDB3-3.11.14_win64/usr/share/arangodb3/js"),
        resources.join("resources/backend/aistock-backend.exe"),
        resources.join("resources/next/standalone/node/node.exe"),
    )
}

/// 啟動離線三程序；線上薄殼（未打包 resources）時直接返回空。
fn spawn_offline(app: &tauri::App) -> Vec<Child> {
    let resources = match app.path().resource_dir() {
        Ok(p) => p,
        Err(e) => {
            error!("resource_dir 取得失敗: {e}");
            return vec![];
        }
    };
    let (arango_bin, arango_js, backend_bin, node_exe) = resource_paths(&resources);

    if !(arango_bin.exists() && backend_bin.exists() && node_exe.exists()) {
        info!("離線資源不存在 — 以線上薄殼模式啟動");
        return vec![];
    }

    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| resources);
    let arango_data = data_dir.join("arangodb");
    let arango_apps = data_dir.join("arangodb-apps");
    let _ = std::fs::create_dir_all(&arango_data);
    let _ = std::fs::create_dir_all(&arango_apps);

    let mut children = vec![];

    match Command::new(&arango_bin)
        .args([
            "--server.endpoint",
            "tcp://127.0.0.1:8530",
            "--database.directory",
            arango_data.to_string_lossy().as_ref(),
            "--server.authentication",
            "false",
            "--javascript.startup-directory",
            arango_js.to_string_lossy().as_ref(),
            "--javascript.app-path",
            arango_apps.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => {
            info!("arangod 已啟動");
            children.push(c);
        }
        Err(e) => error!("arangod 啟動失敗: {e}"),
    }

    match Command::new(&backend_bin)
        .args(["--host", "127.0.0.1", "--port", "38000"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => {
            info!("backend 已啟動");
            children.push(c);
        }
        Err(e) => error!("backend 啟動失敗: {e}"),
    }

    // node.exe 位於 <standalone>/node/node.exe → server dir 取其父的父層
    let server_dir = node_exe
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    match Command::new(&node_exe)
        .current_dir(&server_dir)
        .arg("server.js")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", "33300")
        .env("BACKEND_URL", "http://127.0.0.1:38000")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => {
            info!("Next standalone 已啟動");
            children.push(c);
        }
        Err(e) => error!("node 啟動失敗: {e}"),
    }

    children
}

fn port_open(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}").parse();
    match addr {
        Ok(a) => TcpStream::connect_timeout(&a, Duration::from_millis(300)).is_ok(),
        Err(_) => false,
    }
}

/// 輪詢三程序就緒後，把主視窗導向本機 Next（離線版）。
fn wait_ready_then_navigate(app: tauri::AppHandle) {
    thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let ready = port_open("127.0.0.1", 8530)
                && port_open("127.0.0.1", 38000)
                && port_open("127.0.0.1", 33300);
            if ready || Instant::now() > deadline {
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(u) = "http://127.0.0.1:33300".parse() {
                let _ = window.navigate(u);
            }
        }
    });
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Starting EEA - My AI Stock Tauri shell");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .manage(OfflineProcesses(Mutex::new(vec![])))
        .setup(|app| {
            let children = spawn_offline(app);
            if let Ok(mut guard) = app.state::<OfflineProcesses>().0.lock() {
                *guard = children;
            }
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(title) = app.config().product_name.clone().ok_or(()) {
                    let _ = window.set_title(&title);
                }
                info!("Window loaded: {:?}", window.title());
            }
            wait_ready_then_navigate(app.handle().clone());
            Ok(())
        })
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Ok(mut guard) = app_handle.state::<OfflineProcesses>().0.lock() {
                    for child in guard.iter_mut() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .expect("error while running tauri application");
}
