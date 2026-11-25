mod commands;
mod domain;
mod dto;
mod infra;
mod service;

use notify::RecommendedWatcher;
use service::{LogService, default_daylog_folder};
use std::sync::{Arc, Condvar, Mutex};

pub struct AppState {
    pub service: Arc<Mutex<LogService>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub startup: Arc<(Mutex<bool>, Condvar)>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let service = Arc::new(Mutex::new(LogService::new()));
    let startup_service = service.clone();
    let startup = Arc::new((Mutex::new(false), Condvar::new()));
    let startup_signal = startup.clone();
    std::thread::spawn(move || {
        match startup_service.lock() {
            Ok(mut service) => service.initialize_default(),
            Err(error) => eprintln!("Could not initialize DayLogs: {error}"),
        }
        let (ready, ready_signal) = &*startup_signal;
        if let Ok(mut ready) = ready.lock() {
            *ready = true;
            ready_signal.notify_all();
        }
    });
    let watcher = default_daylog_folder()
        .filter(|root| root.is_dir())
        .and_then(|root| infra::watcher::watch_folder(root, service.clone()).ok());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            service,
            watcher: Mutex::new(watcher),
            startup,
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_overview,
            commands::get_day_data,
            commands::get_app_segments,
            commands::load_folder,
            commands::load_files,
            commands::load_file_paths,
            commands::load_demo,
            commands::load_bundled_demo,
            commands::set_app_visibility,
            commands::set_folder,
            commands::save_folders
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
