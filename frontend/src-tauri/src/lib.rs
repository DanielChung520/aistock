use log::info;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use std::thread;
use tauri::Manager;

pub fn run() {
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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

fn find_project_root(exe_path: &Path) -> PathBuf {
    let mut current = exe_path.parent();
    while let Some(dir) = current {
        if dir.join("backend").join("src").join("main.py").exists() {
            return dir.to_path_buf();
        }
        current = dir.parent();
    }
    std::env::current_dir().expect("failed to get current dir")
}

fn spawn_backend(project_root: &Path) -> Child {
    let venv_python = if cfg!(target_os = "windows") {
        project_root.join("backend").join(".venv").join("Scripts").join("python.exe")
    } else {
        project_root.join("backend").join(".venv").join("bin").join("python")
    };

    Command::new(&venv_python)
        .arg("-m")
        .arg("uvicorn")
        .arg("src.main:app")
        .arg("--host")
        .arg("0.0.0.0")
        .arg("--port")
        .arg("38000")
        .current_dir(project_root.join("backend"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|_| {
            // Fallback to system python
            Command::new("python3")
                .arg("-m")
                .arg("uvicorn")
                .arg("src.main:app")
                .arg("--host")
                .arg("0.0.0.0")
                .arg("--port")
                .arg("38000")
                .current_dir(project_root.join("backend"))
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("failed to spawn backend")
        })
}

fn spawn_frontend(project_root: &Path) -> Child {
    let next_dir = project_root.join("frontend");
    let cmd = if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" };
    Command::new(cmd)
        .arg("next")
        .arg("start")
        .arg("--port")
        .arg("3300")
        .current_dir(&next_dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn frontend")
}

fn wait_for_url(url: &str, timeout: Duration) {
    use std::time::Instant;
    let start = Instant::now();
    while start.elapsed() < timeout {
        if reqwest::blocking::get(url).is_ok() {
            info!("URL ready: {}", url);
            return;
        }
        thread::sleep(Duration::from_millis(500));
    }
    info!("URL timeout (continuing): {}", url);
}
