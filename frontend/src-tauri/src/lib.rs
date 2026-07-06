use log::info;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use tauri::Manager;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Starting aiStock Tauri application");

    let exe_path = std::env::current_exe().expect("failed to get exe path");
    let project_root = find_project_root(&exe_path);
    info!("Project root: {:?}", project_root);

    // Detect development mode: project source tree exists next to the binary
    let is_dev = project_root.join("backend").join("src").join("main.py").exists();
    info!("Running in {} mode", if is_dev { "development" } else { "production" });

    if is_dev {
        // Development mode: spawn FastAPI backend only.
        // Frontend is started by beforeDevCommand (pnpm run dev).
        match spawn_backend(&project_root) {
            Ok(child) => info!("FastAPI spawned (PID: {})", child.id()),
            Err(e) => log::warn!("Failed to spawn backend: {}", e),
        }
    } else {
        // Production (bundled .app / .dmg) mode:
        // - Frontend: Tauri serves static files from frontendDist ("../.next")
        // - Backend: FastAPI must be started separately by the user (not bundled)
        info!("Production bundle: frontend served from embedded assets, backend unavailable");
    }

    tauri::Builder::default()
        // updater plugin disabled until plugins.updater config is added to tauri.conf.json
        // .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("aiStock - 台股分析平台");
                info!("Window loaded");
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
    // Fallback: check if CWD has the project structure
    let cwd = std::env::current_dir().expect("failed to get current dir");
    if cwd.join("backend").join("src").join("main.py").exists() {
        return cwd;
    }
    cwd
}

fn spawn_backend(project_root: &Path) -> Result<Child, String> {
    let venv_python = if cfg!(target_os = "windows") {
        project_root
            .join("backend")
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        project_root
            .join("backend")
            .join(".venv")
            .join("bin")
            .join("python")
    };

    let backend_dir = project_root.join("backend");

    let run_python = |python: &Path| -> Result<Child, std::io::Error> {
        Command::new(python)
            .arg("-m")
            .arg("uvicorn")
            .arg("src.main:app")
            .arg("--host")
            .arg("0.0.0.0")
            .arg("--port")
            .arg("38000")
            .current_dir(&backend_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    };

    run_python(&venv_python)
        .or_else(|_| run_python(Path::new("python3")))
        .map_err(|e| format!("failed to spawn backend: {}", e))
}
