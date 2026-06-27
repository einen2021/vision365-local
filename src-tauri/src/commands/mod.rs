use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use crate::ApiServerState;

#[derive(Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub maximized: bool,
}

#[tauri::command]
pub fn resolve_local_asset_src(app: AppHandle, url: String) -> Result<String, String> {
    if !url.starts_with("/local/") {
        return Err("Not a local asset URL".into());
    }

    let relative = url
        .trim_start_matches("/local/")
        .trim_start_matches('/')
        .replace('\\', "/");

    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let mut candidates = vec![app_data.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))];
    if !relative.starts_with("uploads/") {
        candidates.push(
            app_data.join("uploads").join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)),
        );
    }
    if relative.starts_with("uploads/floor-plans/") {
        candidates.push(
            app_data.join(relative["uploads/".len()..].replace('/', std::path::MAIN_SEPARATOR_STR)),
        );
    }
    if relative.starts_with("floor-plans/") {
        candidates.push(
            app_data.join("uploads").join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)),
        );
    }

    for path in candidates {
        if path.is_file() {
            return Ok(path.to_string_lossy().to_string());
        }
    }

    Err(format!("Local asset not found: {url}"))
}

#[tauri::command]
pub fn get_app_data_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_api_port(state: State<ApiServerState>) -> Option<u16> {
    *state.port.lock().unwrap()
}

#[tauri::command]
pub fn is_db_ready(state: State<ApiServerState>) -> bool {
    *state.ready.lock().unwrap()
}

#[tauri::command]
pub fn get_server_log(app: AppHandle) -> String {
    if let Ok(app_data) = app.path().app_data_dir() {
        let log_path = app_data.join("logs").join("server.log");
        if log_path.exists() {
            return std::fs::read_to_string(log_path).unwrap_or_default();
        }
    }
    if let Some(state) = app.try_state::<ApiServerState>() {
        if let Some(err) = state.last_error.lock().unwrap().as_ref() {
            return err.clone();
        }
    }
    String::new()
}

#[tauri::command]
pub async fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_window_state(app: AppHandle, state: WindowState) -> Result<(), String> {
    let settings_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings");

    std::fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;

    let path = settings_dir.join("window.json");
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn load_window_state(app: AppHandle) -> Result<Option<WindowState>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("settings")
        .join("window.json");

    if !path.exists() {
        return Ok(None);
    }

    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let state: WindowState = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    Ok(Some(state))
}
