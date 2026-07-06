use log::info;
use tauri::Manager;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Starting EEA - My AI Stock Tauri shell");

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(title) = app.config().product_name.clone().ok_or(()) {
                    let _ = window.set_title(&title);
                }
                info!("Window loaded: {:?}", window.title());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
