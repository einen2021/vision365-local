mod commands;

use std::fs::{OpenOptions, create_dir_all};
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, RunEvent};

const API_PORT: u16 = 47821;
const MONGO_PORT: u16 = 47820;

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
            commands::get_api_port,
            commands::is_db_ready,
            commands::get_server_log,
            commands::show_notification,
            commands::save_window_state,
            commands::load_window_state,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }

            let app_handle = app.handle().clone();

            match spawn_and_wait_for_server(app) {
                Ok(port) => {
                    if let Some(state) = app.try_state::<ApiServerState>() {
                        *state.port.lock().unwrap() = Some(port);
                        *state.ready.lock().unwrap() = true;
                    }
                    let _ = app_handle.emit("vision365-api-ready", port);
                    log_message(app, &format!("Database ready on port {port}"));

                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                Err(e) => {
                    log_message(app, &format!("Database init failed: {e}"));
                    if let Some(state) = app.try_state::<ApiServerState>() {
                        *state.last_error.lock().unwrap() = Some(e.clone());
                    }
                    let _ = app_handle.emit("vision365-api-error", e);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                    }
                }
            }

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

fn log_message(app: &tauri::App, msg: &str) {
    eprintln!("[vision365] {msg}");
    if let Ok(app_data) = app.path().app_data_dir() {
        let log_path = app_data.join("logs").join("server.log");
        let _ = create_dir_all(app_data.join("logs"));
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "[vision365] {msg}");
        }
    }
}

fn spawn_and_wait_for_server(app: &tauri::App) -> Result<u16, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data path: {e}"))?;

    create_dir_all(&app_data)
        .map_err(|e| format!("Cannot create app data directory: {e}"))?;
    create_dir_all(app_data.join("database"))
        .map_err(|e| format!("Cannot create database directory: {e}"))?;
    create_dir_all(app_data.join("database").join("mongodb"))
        .map_err(|e| format!("Cannot create MongoDB data directory: {e}"))?;
    create_dir_all(app_data.join("logs"))
        .map_err(|e| format!("Cannot create logs directory: {e}"))?;

    let app_data_str = app_data.to_string_lossy().to_string();
    log_message(app, &format!("App data: {app_data_str}"));

    let seed_path = resolve_seed_path(app);

    // Production: start bundled embedded MongoDB before the API server
    if !cfg!(debug_assertions) {
        if let Err(e) = spawn_embedded_mongodb(app, &app_data) {
            return Err(format!("MongoDB startup failed: {e}"));
        }
    }

    let mut cmd = if cfg!(debug_assertions) {
        let mut c = Command::new(if cfg!(windows) { "npx.cmd" } else { "npx" });
        c.args(["tsx", "desktop-server/src/index.ts"]);
        if let Ok(cwd) = std::env::current_dir() {
            c.current_dir(cwd);
        }
        c
    } else {
        let (node, script, work_dir) = resolve_production_server(app).ok_or_else(|| {
            let msg =
                "Could not find bundled database server (node.exe / index.cjs missing)".to_string();
            log_message(app, &msg);
            msg
        })?;
        log_message(
            app,
            &format!(
                "Spawning server: {} {} (cwd: {})",
                node.display(),
                script.display(),
                work_dir.display()
            ),
        );
        let mut c = Command::new(&node);
        c.arg(&script).current_dir(&work_dir);
        c.env("NODE_PATH", &work_dir);
        c
    };

    cmd.env("VISION365_APP_DATA", &app_data_str)
        .env("VISION365_PORT", API_PORT.to_string())
        .env(
            "VISION365_MONGO_URI",
            format!("mongodb://127.0.0.1:{MONGO_PORT}"),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref seed) = seed_path {
        cmd.env("VISION365_SEED_PATH", seed);
        log_message(app, &format!("Seed: {seed}"));
    } else {
        log_message(app, "Seed: using built-in defaults");
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

    if let Some(stdout) = child.stdout.take() {
        let log = log_path.clone();
        std::thread::spawn(move || pipe_to_log(stdout, &log, false));
    }
    if let Some(stderr) = child.stderr.take() {
        let log = log_path.clone();
        std::thread::spawn(move || pipe_to_log(stderr, &log, true));
    }

    // Wait for health check (server writes server-port.json + listens)
    if let Err(e) = wait_for_health(API_PORT, 90) {
        // Read last lines of log for better error message
        let log_tail = read_log_tail(&log_path, 8);
        return Err(format!("{e}\n\nServer log:\n{log_tail}"));
    }

    Ok(API_PORT)
}

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    format!("{}s", d.as_secs())
}

fn pipe_to_log<R: std::io::Read>(reader: R, log_path: &std::path::Path, is_err: bool) {
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

fn wait_for_health(port: u16, timeout_secs: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

    while std::time::Instant::now() < deadline {
        if check_health(port) {
            return Ok(());
        }
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
    app: &tauri::App,
) -> Option<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf)> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(dir) = app.path().resource_dir() {
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
        let mongodb = server_dir.join("node_modules").join("mongodb");

        log_message(
            app,
            &format!(
                "Check: node={} script={} mongodb={}",
                node.exists(),
                script.exists(),
                mongodb.exists()
            ),
        );

        if node.exists() && script.exists() {
            if !mongodb.exists() {
                log_message(app, "WARNING: mongodb package missing in bundle");
            }
            return Some((node, script, server_dir));
        }
    }

    None
}

fn spawn_embedded_mongodb(app: &tauri::App, app_data: &std::path::Path) -> Result<(), String> {
    let mongod = resolve_mongod_binary(app).ok_or_else(|| {
        "Could not find bundled mongod.exe in application resources".to_string()
    })?;

    let db_path = app_data.join("database").join("mongodb");
    create_dir_all(&db_path).map_err(|e| format!("Cannot create MongoDB data path: {e}"))?;

    log_message(
        app,
        &format!(
            "Starting MongoDB: {} --dbpath {} --port {}",
            mongod.display(),
            db_path.display(),
            MONGO_PORT
        ),
    );

    let mut cmd = Command::new(&mongod);
    cmd.args([
        "--dbpath",
        &db_path.to_string_lossy(),
        "--port",
        &MONGO_PORT.to_string(),
        "--bind_ip",
        "127.0.0.1",
    ])
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start mongod: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        let log = app_data.join("logs").join("server.log");
        std::thread::spawn(move || pipe_to_log(stderr, &log, true));
    }

    wait_for_mongo_port(MONGO_PORT, 60)?;
    log_message(app, &format!("MongoDB ready on port {MONGO_PORT}"));
    Ok(())
}

fn wait_for_mongo_port(port: u16, timeout_secs: u64) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);

    while std::time::Instant::now() < deadline {
        let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
            Ok(a) => a,
            Err(_) => return Err("Invalid MongoDB address".to_string()),
        };
        if TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    Err(format!(
        "MongoDB did not respond within {timeout_secs}s on port {port}"
    ))
}

fn resolve_mongod_binary(app: &tauri::App) -> Option<std::path::PathBuf> {
    let exe_name = if cfg!(windows) { "mongod.exe" } else { "mongod" };
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("mongodb").join("bin").join(exe_name));
        candidates.push(
            dir.join("resources")
                .join("mongodb")
                .join("bin")
                .join(exe_name),
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(
                parent
                    .join("resources")
                    .join("mongodb")
                    .join("bin")
                    .join(exe_name),
            );
        }
    }

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }

    None
}

fn resolve_seed_path(app: &tauri::App) -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();

    if let Ok(dir) = app.path().resource_dir() {
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
