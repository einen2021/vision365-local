mod commands;
mod siren;
#[cfg(windows)]
mod winaudio;

use std::fs::{OpenOptions, create_dir_all};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

const API_PORT: u16 = 47821;

const STARTUP_TOTAL: u32 = 12;

fn emit_progress(handle: &AppHandle, step: u32, message: &str) {
    let percent = ((step as f32 / STARTUP_TOTAL as f32) * 100.0).round() as u32;
    let _ = handle.emit(
        "vision365-startup-progress",
        serde_json::json!({
            "step": step,
            "total": STARTUP_TOTAL,
            "percent": percent.min(100),
            "message": message,
        }),
    );
}

fn finish_startup(handle: &AppHandle, port: u16) {
    if let Some(state) = handle.try_state::<ApiServerState>() {
        *state.port.lock().unwrap() = Some(port);
        *state.ready.lock().unwrap() = true;
    }
    emit_progress(handle, 5, "Database ready");
    let _ = handle.emit("vision365-api-ready", port);
    log_message(handle, &format!("Database ready on port {port}"));
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

fn fail_startup(handle: &AppHandle, error: String) {
    log_message(handle, &format!("Database init failed: {error}"));
    if let Some(state) = handle.try_state::<ApiServerState>() {
        *state.last_error.lock().unwrap() = Some(error.clone());
    }
    let _ = handle.emit("vision365-api-error", error);
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
    }
}

pub(crate) struct ApiServerState {
    port: Mutex<Option<u16>>,
    ready: Mutex<bool>,
    last_error: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(ApiServerState {
            port: Mutex::new(Some(API_PORT)),
            ready: Mutex::new(false),
            last_error: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_data_path,
            commands::resolve_local_asset_src,
            commands::get_api_port,
            commands::is_db_ready,
            commands::get_server_log,
            commands::show_notification,
            commands::save_window_state,
            commands::load_window_state,
            commands::emergency_exit,
            siren::start_fire_siren,
            siren::stop_fire_siren,
            siren::play_panel_alert_beep,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("vision365-window-close-requested", ());
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Show splash immediately so startup progress is visible
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            emit_progress(&app_handle, 1, "Preparing application data");

            std::thread::spawn(move || {
                match spawn_and_wait_for_server(&app_handle) {
                    Ok(port) => finish_startup(&app_handle, port),
                    Err(e) => fail_startup(&app_handle, e),
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let _ = app_handle;
        }
    });
}

fn log_message(handle: &AppHandle, msg: &str) {
    eprintln!("[vision365] {msg}");
    if let Ok(app_data) = handle.path().app_data_dir() {
        let log_path = app_data.join("logs").join("server.log");
        let _ = create_dir_all(app_data.join("logs"));
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "[vision365] {msg}");
        }
    }
}

fn spawn_and_wait_for_server(handle: &AppHandle) -> Result<u16, String> {
    let app_data = handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data path: {e}"))?;

    create_dir_all(&app_data)
        .map_err(|e| format!("Cannot create app data directory: {e}"))?;
    create_dir_all(app_data.join("database"))
        .map_err(|e| format!("Cannot create database directory: {e}"))?;
    create_dir_all(app_data.join("logs"))
        .map_err(|e| format!("Cannot create logs directory: {e}"))?;

    let app_data_str = app_data.to_string_lossy().to_string();
    log_message(handle, &format!("App data: {app_data_str}"));

    let seed_path = resolve_seed_path(handle);

    emit_progress(handle, 2, "Preparing SQLite database");

    emit_progress(handle, 3, "Launching local server");

    let mut cmd = if cfg!(debug_assertions) {
        let mut c = Command::new(if cfg!(windows) { "npx.cmd" } else { "npx" });
        c.args(["tsx", "desktop-server/src/index.ts"]);
        if let Ok(cwd) = std::env::current_dir() {
            c.current_dir(cwd);
        }
        c
    } else {
        let (node, script, work_dir) = resolve_production_server(handle).ok_or_else(|| {
            let msg =
                "Could not find bundled database server (node.exe / index.cjs missing)".to_string();
            log_message(handle, &msg);
            msg
        })?;
        log_message(
            handle,
            &format!(
                "Spawning server: {} {} (cwd: {})",
                node.display(),
                script.display(),
                work_dir.display()
            ),
        );
        let mut c = Command::new(&node);
        // Node 22 ships sqlite as experimental — enable it for the bundled server.
        c.arg("--experimental-sqlite")
            .arg(&script)
            .current_dir(&work_dir);
        c.env("NODE_PATH", &work_dir);
        c
    };

    cmd.env("VISION365_APP_DATA", &app_data_str)
        .env("VISION365_PORT", API_PORT.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref seed) = seed_path {
        cmd.env("VISION365_SEED_PATH", seed);
        log_message(handle, &format!("Seed: {seed}"));
    } else {
        log_message(handle, "Seed: using built-in defaults");
    }

    if cfg!(windows) {
        // Prevent extra console window on Windows
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
    }

    let log_path = app_data.join("logs").join("server.log");
    let _ = std::fs::write(&log_path, format!("--- Vision365 startup {} ---\n", chrono_lite_now()));

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start database server: {e}"))?;

    let progress_handle = Arc::new(handle.clone());

    if let Some(stdout) = child.stdout.take() {
        let log = log_path.clone();
        let ph = Arc::clone(&progress_handle);
        std::thread::spawn(move || pipe_to_log(stdout, &log, false, Some(ph)));
    }
    if let Some(stderr) = child.stderr.take() {
        let log = log_path.clone();
        let ph = Arc::clone(&progress_handle);
        std::thread::spawn(move || pipe_to_log(stderr, &log, true, Some(ph)));
    }

    emit_progress(handle, 4, "Connecting to database");

    // Wait for health check (server writes server-port.json + listens)
    if let Err(e) = wait_for_health(handle, API_PORT, 90) {
        let log_tail = read_log_tail(&log_path, 8);
        return Err(format!("{e}\n\nServer log:\n{log_tail}"));
    }

    emit_progress(handle, 5, "Loading application data");

    Ok(API_PORT)
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}s", d.as_secs())
}

fn pipe_to_log<R: std::io::Read>(
    reader: R,
    log_path: &std::path::Path,
    is_err: bool,
    progress_handle: Option<Arc<AppHandle>>,
) {
    let buf_reader = BufReader::new(reader);
    for line in buf_reader.lines().map_while(Result::ok) {
        if is_err {
            eprintln!("[desktop-server:err] {}", line);
        } else {
            println!("[desktop-server] {}", line);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "{}", line);
        }
        if let Some(ref handle) = progress_handle {
            apply_server_log_progress(handle, &line);
        }
    }
}

fn apply_server_log_progress(handle: &AppHandle, line: &str) {
    let lower = line.to_lowercase();
    if lower.contains("sqlite connected") {
        emit_progress(handle, 4, "SQLite database connected");
    } else if lower.contains("migrations complete") {
        emit_progress(handle, 4, "Database migrations complete");
    } else if lower.contains("seed complete") || lower.contains("restored database from") {
        emit_progress(handle, 5, "Initial data loaded");
    } else if lower.contains("running at http") {
        emit_progress(handle, 5, "Local server started");
    }
}

fn read_log_tail(path: &std::path::Path, lines: usize) -> String {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    content
        .lines()
        .rev()
        .take(lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn wait_for_health(handle: &AppHandle, port: u16, timeout_secs: u64) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let started = Instant::now();
    let total = Duration::from_secs(timeout_secs);

    while Instant::now() < deadline {
        if check_health(port) {
            return Ok(());
        }
        let elapsed = started.elapsed();
        let sub_percent = ((elapsed.as_secs_f64() / total.as_secs_f64()) * 100.0).min(99.0) as u32;
        emit_progress(
            handle,
            4,
            &format!("Connecting to database ({sub_percent}%)"),
        );
        std::thread::sleep(Duration::from_millis(400));
    }

    Err(format!(
        "Database server did not respond within {timeout_secs}s on port {port}"
    ))
}

fn check_health(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let request =
        "GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut reader = BufReader::new(stream);
    let mut status_line = String::new();
    if reader.read_line(&mut status_line).is_err() {
        return false;
    }

    status_line.contains("200")
}

fn resolve_production_server(
    handle: &AppHandle,
) -> Option<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf)> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(dir) = handle.path().resource_dir() {
        candidates.push(dir.clone());
        // Tauri may nest resources under a resources/ subfolder
        candidates.push(dir.join("resources"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources"));
            candidates.push(parent.to_path_buf());
        }
    }

    for base in candidates {
        let node = base.join("node").join("node.exe");
        let server_dir = base.join("server");
        let script = server_dir.join("index.cjs");

        log_message(
            handle,
            &format!(
                "Check: node={} script={}",
                node.exists(),
                script.exists()
            ),
        );

        if node.exists() && script.exists() {
            return Some((node, script, server_dir));
        }
    }

    None
}

fn resolve_seed_path(handle: &AppHandle) -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(dir) = handle.path().resource_dir() {
        candidates.push(dir.join("db-seed.json"));
        candidates.push(dir.join("resources").join("db-seed.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("resources").join("db-seed.json"));
            candidates.push(parent.join("db-seed.json"));
        }
    }

    for path in candidates {
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }

    None
}
