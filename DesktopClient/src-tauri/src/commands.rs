use crate::{
    AppState,
    infra::{settings_store::FolderSetting, watcher::watch_folder},
};
use std::path::PathBuf;

#[tauri::command]
pub fn get_state(state: tauri::State<'_, AppState>) -> Result<crate::dto::ClientStateDto, String> {
    let (ready, signal) = &*state.startup;
    let mut initialized = ready.lock().map_err(|error| error.to_string())?;
    while !*initialized {
        initialized = signal
            .wait(initialized)
            .map_err(|error| error.to_string())?;
    }
    drop(initialized);
    state
        .service
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.state())
}

#[tauri::command]
pub fn load_folder(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::ClientStateDto, String> {
    let path = PathBuf::from(path);
    let mut service = state.service.lock().map_err(|error| error.to_string())?;
    service.load_folder(&path)?;
    let result = service.state();
    drop(service);
    let watcher = watch_folder(path, state.service.clone()).map_err(|error| error.to_string())?;
    *state.watcher.lock().map_err(|error| error.to_string())? = Some(watcher);
    Ok(result)
}

#[tauri::command]
pub fn load_files(
    files: Vec<(String, String)>,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::ClientStateDto, String> {
    let mut service = state.service.lock().map_err(|error| error.to_string())?;
    service.load_files(files);
    drop(service);
    *state.watcher.lock().map_err(|error| error.to_string())? = None;
    state
        .service
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.state())
}

#[tauri::command]
pub fn load_file_paths(
    paths: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::ClientStateDto, String> {
    let paths = paths.into_iter().map(PathBuf::from).collect();
    let mut service = state.service.lock().map_err(|error| error.to_string())?;
    service.load_file_paths(paths)?;
    let result = service.state();
    drop(service);
    *state.watcher.lock().map_err(|error| error.to_string())? = None;
    Ok(result)
}

#[tauri::command]
pub fn load_demo(
    text: String,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::ClientStateDto, String> {
    let mut service = state.service.lock().map_err(|error| error.to_string())?;
    service.load_demo(&text);
    let result = service.state();
    drop(service);
    *state.watcher.lock().map_err(|error| error.to_string())? = None;
    Ok(result)
}

#[tauri::command]
pub fn load_bundled_demo(
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::ClientStateDto, String> {
    let mut service = state.service.lock().map_err(|error| error.to_string())?;
    service.load_bundled_demo();
    let result = service.state();
    drop(service);
    *state.watcher.lock().map_err(|error| error.to_string())? = None;
    Ok(result)
}

#[tauri::command]
pub fn get_overview(
    span: usize,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::OverviewDto, String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.overview(span))
}

#[tauri::command]
pub fn get_day_data(
    date: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<crate::dto::DayDetailDto>, String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.day_detail(&date))
}

#[tauri::command]
pub fn get_app_segments(
    entity: String,
    start: String,
    end: String,
    state: tauri::State<'_, AppState>,
) -> Result<crate::dto::EntitySegmentsDto, String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())
        .map(|service| service.app_segments(&entity, &start, &end))
}

#[tauri::command]
pub fn set_app_visibility(
    exe: String,
    show: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())?
        .set_app_visibility(&exe, show)
}

#[tauri::command]
pub fn set_apps_visibility(
    exes: Vec<String>,
    show: bool,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())?
        .set_apps_visibility(&exes, show)
}

#[tauri::command]
pub fn set_folder(folder: FolderSetting, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())?
        .set_folder(folder)
}

#[tauri::command]
pub fn save_folders(
    folders: Vec<FolderSetting>,
    next_id: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .service
        .lock()
        .map_err(|error| error.to_string())?
        .save_folders(folders, next_id)
}
