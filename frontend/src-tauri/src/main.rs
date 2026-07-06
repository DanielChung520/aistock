#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::info;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use std::thread;
use tauri::Manager;

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Starting aiStock Tauri application");

    let exe_path = std::env::current_exe().expect("failed to get exe path");
    let project_root = find_project_root(&exe_path);
    info!("Project root: {:?}", project_root);

    let backend_handle = spawn_backend(&project_root);
    info!("FastAPI spawned (PID: {})", backend_handle.id());

    let next_handle = spawn_frontend(&project_root);
    info!("Next.js server spawned (PID: {})", next_handle.id());

    wait_for_url("http://localhost:3300", Duration::from_secs(30));

    tauri::Builder::default()
        .setup(move |app| {
            if let Some(window) = app.get_window("main") {
                window.set_title("aiStock - 台股分析平台").ok();
                info!("Window loading Next.js server");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Walk up from the executable path to find the project root
/// (directory containing `backend/src/main.py`).
fn find_project_root(exe_path: &Path) -> PathBuf {
    let mut dir = exe_path
        .parent()
        .expect("exe path has no parent")
        .to_path_buf();
    loop {
        if dir.join("backend").join("src").join("main.py").is_file() {
            return dir.to_path_buf();
        }
        if !dir.pop() {
            panic!(
                "could not find project root (backend/src/main.py) from exe path: {:?}",
                exe_path
            );
        }
    }
}

fn spawn_backend(project_root: &Path) -> Child {
    let backend_dir = project_root.join("backend");
    // Use the venv python if available, fall back to python3
    let python = backend_dir.join(".venv").join("bin").join("python");
    let python = if python.is_file() {
        python
    } else {
        PathBuf::from("python3")
    };
    let stderr_log = project_root.join("backend").join("logs").join("uvicorn-stderr.log");
    let stderr_file = std::fs::File::create(&stderr_log)
        .expect("Failed to create uvicorn stderr log");
    let stdout_log = project_root.join("backend").join("logs").join("uvicorn-stdout.log");
    let stdout_file = std::fs::File::create(&stdout_log)
        .expect("Failed to create uvicorn stdout log");
    Command::new(python)
        .args(["-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"])
        .current_dir(&backend_dir)
        .stdout(stdout_file)
        .stderr(stderr_file)
        .spawn()
        .expect("Failed to start FastAPI backend")
}

fn spawn_frontend(project_root: &Path) -> Child {
    let frontend_dir = project_root.join("frontend");
    let next_bin = frontend_dir.join("node_modules").join(".bin").join("next");
    let next_bin = if next_bin.is_file() {
        next_bin
    } else {
        PathBuf::from("npx")
    };
    let stderr_log = project_root.join("backend").join("logs").join("next-stderr.log");
    let stderr_file = std::fs::File::create(&stderr_log)
        .expect("Failed to create next stderr log");
    Command::new(next_bin)
        .args(["start", "--port", "3300"])
        .current_dir(&frontend_dir)
        .stdout(Stdio::null())
        .stderr(stderr_file)
        .spawn()
        .expect("Failed to start Next.js server")
}

fn wait_for_url(url: &str, timeout: Duration) {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(output) = Command::new("curl")
            .args(["-s", "-o", "/dev/null", "-w", "%{http_code}", url])
            .output()
        {
            let code = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if code == "200" {
                info!("{} is ready", url);
                return;
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    info!("Timeout waiting for {}", url);
}
