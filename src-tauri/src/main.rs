use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone)]
struct EngineState {
    socket_path: PathBuf,
    auth_token: String,
    child: Arc<Mutex<Option<Child>>>,
}

fn session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| format!("Unable to obtain local engine session entropy: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobConfig {
    input_paths: Vec<String>,
    profile: String,
    job_id: Option<String>,
    workspace_dir: Option<String>,
    outputs: Option<Vec<String>>,
    local_repair: Option<bool>,
    cache_policy: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewAction {
    ir_path: String,
    block_id: String,
    review_action: String,
    text: Option<String>,
    candidate_index: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobHistory {
    id: String,
    created_at: String,
    profile: String,
    status: String,
    documents: i64,
    warnings: i64,
    payload: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchItem {
    id: String,
    batch_id: String,
    source_path: String,
    status: String,
    error: Option<String>,
    result: Option<Value>,
    created_at: String,
    updated_at: String,
}

/// A document converter is deliberately non-interruptible once it has begun:
/// its file outputs are atomic, while killing it mid-render is not.  This
/// helper makes the publication boundary explicit and unit-testable.
fn publish_completed_batch_document(requested_state: Option<&str>) -> bool {
    !matches!(requested_state, Some("paused") | Some("cancelled"))
}

fn batch_status_after_run(remaining_nonterminal_items: i64) -> &'static str {
    if remaining_nonterminal_items > 0 { "queued" } else { "completed" }
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

fn engine_python() -> PathBuf {
    if cfg!(debug_assertions) {
        let virtualenv = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.venv/bin/python");
        if virtualenv.exists() {
            return virtualenv;
        }
    }
    PathBuf::from("python3")
}

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let directory = app_data(app)?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let database = Connection::open(directory.join("philon.sqlite3")).map_err(|error| error.to_string())?;
    database
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                profile TEXT NOT NULL,
                status TEXT NOT NULL,
                documents INTEGER NOT NULL,
                warnings INTEGER NOT NULL,
                payload TEXT NOT NULL
            );",
        )
        .map_err(|error| error.to_string())?;
    database
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS batch_jobs (
                id TEXT PRIMARY KEY,
                profile TEXT NOT NULL,
                cache_policy TEXT,
                outputs TEXT,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS batch_items (
                id TEXT PRIMARY KEY,
                batch_id TEXT NOT NULL,
                source_path TEXT NOT NULL,
                status TEXT NOT NULL,
                error TEXT,
                result TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(batch_id) REFERENCES batch_jobs(id)
            );
            CREATE INDEX IF NOT EXISTS batch_items_by_batch ON batch_items(batch_id, status);",
        )
        .map_err(|error| error.to_string())?;
    // Existing alpha databases predate per-batch preferences. SQLite does not
    // offer an idempotent ADD COLUMN, so duplicate-column errors are harmless.
    let _ = database.execute("ALTER TABLE batch_jobs ADD COLUMN cache_policy TEXT", []);
    let _ = database.execute("ALTER TABLE batch_jobs ADD COLUMN outputs TEXT", []);
    Ok(database)
}

fn recover_interrupted_batches(app: &AppHandle) -> Result<(), String> {
    let database = connection(app)?;
    let recovered_at = Utc::now().to_rfc3339();
    database.execute("UPDATE batch_items SET status = 'queued', error = 'Recovered after an interrupted Philon session.', updated_at = ?1 WHERE status = 'running'", params![recovered_at]).map_err(|error| error.to_string())?;
    database.execute("UPDATE batch_jobs SET status = 'queued', updated_at = ?1 WHERE status = 'running'", params![recovered_at]).map_err(|error| error.to_string())?;
    Ok(())
}

/// Stop an engine process and everything it started.
///
/// The engine ships as a PyInstaller one-file binary, so the process Philon
/// spawns is a bootloader that runs the real interpreter as a child of its own.
/// Killing only the process we hold leaves that interpreter alive, reparented
/// to launchd and still holding the engine socket: sessions have been found
/// still running a day after their window closed.
///
/// SIGTERM goes first, so the bootloader can remove the temporary directory it
/// unpacked itself into; SIGKILL settles whatever ignored it.
fn stop_engine_process(child: &mut Child) {
    let pid = child.id() as i32;
    let group = unsafe { libc::getpgid(pid) };
    let own_group = unsafe { libc::getpgrp() };
    // Signal the group only when it is the engine's own. If setting the group
    // at spawn ever fails, the child shares this process's group, and killing
    // that group would take Philon down with the engine.
    let grouped = group > 0 && group != own_group;
    let signal = |number: i32| unsafe {
        if grouped { libc::killpg(group, number) } else { libc::kill(pid, number) }
    };

    signal(libc::SIGTERM);
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    signal(libc::SIGKILL);
    let _ = child.wait();
}

/// Stop this session's engine and remove the socket it was listening on.
///
/// Called when the application exits: a quit that leaves the engine running is
/// what orphans it, and a stale socket file would otherwise be adopted by the
/// next session's readiness check.
fn shutdown_engine(state: &EngineState) {
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut process) = child.take() {
            stop_engine_process(&mut process);
        }
    }
    let _ = fs::remove_file(&state.socket_path);
}

fn ensure_engine(app: &AppHandle, state: &EngineState) -> Result<(), String> {
    if state.socket_path.exists() {
        if UnixStream::connect(&state.socket_path).is_ok() {
            return Ok(());
        }
        let _ = fs::remove_file(&state.socket_path);
    }
    let parent = state.socket_path.parent().ok_or("Invalid engine socket path")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut child = state.child.lock().map_err(|_| "Engine worker lock failed")?;
    if let Some(mut previous) = child.take() {
        stop_engine_process(&mut previous);
    }
    let mut command = if cfg!(debug_assertions) {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../engine/philon_engine.py");
        if !script.exists() { return Err(format!("Philon's local engine is missing: {}", script.display())); }
        let mut command = Command::new(engine_python());
        command.arg(script);
        command
    } else {
        let binary = app.path().resource_dir().map(|directory| directory.join("_up_/engine/dist/philon-engine")).map_err(|error| error.to_string())?;
        if !binary.exists() { return Err(format!("Philon's bundled engine is missing: {}. Build it with scripts/package-engine.sh before packaging.", binary.display())); }
        Command::new(binary)
    };
    let vision_helper = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../engine/dist/philon-vision-ocr")
    } else {
        // Tauri preserves parent-relative bundle resources under `_up_` on
        // macOS. Keep this explicit rather than assuming the development
        // directory shape, so the packaged app launches the same local OCR
        // helper that the debug build uses.
        app.path().resource_dir().map(|directory| directory.join("_up_/engine/dist/philon-vision-ocr")).map_err(|error| error.to_string())?
    };
    // The engine is spawned into its own process group so that stopping it can
    // reach the interpreter the PyInstaller bootloader starts, without the
    // signal ever reaching Philon itself.
    command.process_group(0);
    let process = command.arg("--socket").arg(&state.socket_path).arg("--token").arg(&state.auth_token).arg("--vision-helper").arg(vision_helper).spawn().map_err(|error| format!("Unable to launch the local engine: {error}"))?;
    *child = Some(process);
    // The bundled Python engine can take several seconds to initialise its
    // runtime on a cold macOS launch. Poll long enough for that first launch,
    // while still reporting a genuine child-process failure immediately.
    let started = Instant::now();
    let timeout = Duration::from_secs(15);
    while started.elapsed() < timeout {
        if state.socket_path.exists() && UnixStream::connect(&state.socket_path).is_ok() {
            return Ok(());
        }
        if let Some(worker) = child.as_mut() {
            if let Some(status) = worker.try_wait().map_err(|error| format!("Unable to inspect local engine startup: {error}"))? {
                return Err(format!("Philon's local engine exited during startup ({status})."));
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("Philon's local engine did not become ready within 15 seconds.".to_string())
}

fn engine_call_with_progress<F>(app: &AppHandle, state: &EngineState, request: Value, mut on_progress: F) -> Result<Value, String>
where
    F: FnMut(Value),
{
    ensure_engine(app, state)?;
    let mut stream = UnixStream::connect(&state.socket_path).map_err(|error| error.to_string())?;
    let mut authenticated = request;
    authenticated["token"] = Value::String(state.auth_token.clone());
    let encoded = serde_json::to_string(&authenticated).map_err(|error| error.to_string())?;
    stream
        .write_all(format!("{encoded}\n").as_bytes())
        .map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream);
    loop {
        let mut response = String::new();
        let received = reader.read_line(&mut response).map_err(|error| error.to_string())?;
        if received == 0 { return Err("The local engine closed before returning a result.".to_string()); }
        let value: Value = serde_json::from_str(&response).map_err(|error| error.to_string())?;
        if value.get("type").and_then(Value::as_str) == Some("progress") {
            if let Some(payload) = value.get("data").cloned() { on_progress(payload); }
            continue;
        }
        if value.get("ok").and_then(Value::as_bool) == Some(true) {
            return value.get("data").cloned().ok_or("Engine response has no data".to_string());
        }
        return Err(value
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("The local engine returned an invalid response.")
            .to_string());
    }
}

fn engine_call(app: &AppHandle, state: &EngineState, request: Value) -> Result<Value, String> {
    engine_call_with_progress(app, state, request, |_| {})
}

fn copy_export_directory(source: &std::path::Path, destination: &std::path::Path) -> Result<usize, String> {
    let mut copied = 0;
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copied += copy_export_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
            copied += 1;
        }
        // Symlinks are intentionally ignored. Philon's own exports contain
        // regular files, and following an unexpected link could escape the
        // selected conversion directory.
    }
    Ok(copied)
}

fn unique_export_target(destination: &std::path::Path, base_name: &str) -> PathBuf {
    let preferred = destination.join(base_name);
    if !preferred.exists() {
        return preferred;
    }
    for index in 2..10_000 {
        let candidate = destination.join(format!("{base_name} {index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    preferred
}

fn store_history(app: &AppHandle, payload: &Value) -> Result<(), String> {
    let id = payload.get("id").and_then(Value::as_str).unwrap_or_default();
    let profile = payload.get("profile").and_then(Value::as_str).unwrap_or("Balanced");
    let results = payload.get("results").and_then(Value::as_array).map(Vec::len).unwrap_or(0) as i64;
    let warnings = payload
        .get("results")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(|item| item.get("warnings").and_then(Value::as_array).map(Vec::len).unwrap_or(0) as i64).sum())
        .unwrap_or(0);
    let status = if payload.get("failures").and_then(Value::as_array).map(|items| !items.is_empty()).unwrap_or(false) {
        "completed_with_failures"
    } else if warnings > 0 {
        "completed_with_warnings"
    } else {
        "completed"
    };
    connection(app)?
        .execute(
            "INSERT OR REPLACE INTO jobs (id, created_at, profile, status, documents, warnings, payload) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, Utc::now().to_rfc3339(), profile, status, results, warnings, payload.to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn batch_id() -> String {
    format!("batch-{}-{}", Utc::now().timestamp_micros(), std::process::id())
}

fn list_batch_items_for(app: &AppHandle, batch_id: &str) -> Result<Vec<BatchItem>, String> {
    let database = connection(app)?;
    let mut statement = database
        .prepare("SELECT id, batch_id, source_path, status, error, result, created_at, updated_at FROM batch_items WHERE batch_id = ?1 ORDER BY created_at ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement.query_map(params![batch_id], |row| {
        let result: Option<String> = row.get(5)?;
        Ok(BatchItem {
            id: row.get(0)?, batch_id: row.get(1)?, source_path: row.get(2)?, status: row.get(3)?, error: row.get(4)?,
            result: result.and_then(|payload| serde_json::from_str(&payload).ok()), created_at: row.get(6)?, updated_at: row.get(7)?,
        })
    }).map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

fn run_conversion_inner(app: AppHandle, state: &EngineState, config: JobConfig) -> Result<Value, String> {
    if config.input_paths.is_empty() {
        return Err("Choose at least one PDF or image.".to_string());
    }
    let workspace = config.workspace_dir.unwrap_or_else(|| {
        app_data(&app)
            .expect("Application data directory must be available")
            .to_string_lossy()
            .to_string()
    });
    let job_id = config.job_id.clone();
    let request = json!({
        "action": "convert",
        "config": {
            "input_paths": config.input_paths,
            "profile": config.profile,
            "job_id": job_id,
            "workspace_dir": workspace,
            // Source previews and native image extraction are part of a single
            // document inspection, not an optional batch-only enhancement.
            "outputs": config.outputs.unwrap_or_else(|| vec!["machine".into(), "markdown".into(), "html".into(), "ir".into(), "chunks".into(), "evidence".into(), "table_csv".into(), "assets".into(), "manifest".into()]),
            "local_repair": config.local_repair.unwrap_or(false),
            "cache_policy": config.cache_policy.unwrap_or_else(|| "use".into())
        }
    });
    let result = engine_call_with_progress(&app, &state, request, |payload| {
        let _ = app.emit("conversion-progress", payload);
    })?;
    store_history(&app, &result)?;
    Ok(result)
}

fn preflight_conversion_inner(app: AppHandle, state: &EngineState, config: JobConfig) -> Result<Value, String> {
    if config.input_paths.is_empty() {
        return Err("Choose at least one PDF or image.".to_string());
    }
    let job_id = config.job_id;
    engine_call_with_progress(&app, &state, json!({"action": "preflight", "config": {"input_paths": config.input_paths, "job_id": job_id}}), |payload| {
        let _ = app.emit("conversion-progress", payload);
    })
}

#[tauri::command]
fn enqueue_batch(app: AppHandle, config: JobConfig) -> Result<String, String> {
    if config.input_paths.is_empty() { return Err("Choose at least one PDF or image.".to_string()); }
    let id = batch_id();
    let created_at = Utc::now().to_rfc3339();
    let database = connection(&app)?;
    let cache_policy = config.cache_policy.unwrap_or_else(|| "use".into());
    let outputs = config.outputs.unwrap_or_else(|| vec!["machine".into(), "markdown".into(), "html".into(), "ir".into(), "chunks".into(), "evidence".into(), "table_csv".into(), "assets".into(), "manifest".into()]);
    database.execute("INSERT INTO batch_jobs (id, profile, cache_policy, outputs, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5)", params![id, config.profile, cache_policy, serde_json::to_string(&outputs).map_err(|error| error.to_string())?, created_at]).map_err(|error| error.to_string())?;
    for (ordinal, path) in config.input_paths.iter().enumerate() {
        database.execute("INSERT INTO batch_items (id, batch_id, source_path, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'queued', ?4, ?4)", params![format!("{id}-{ordinal}"), id, path, created_at]).map_err(|error| error.to_string())?;
    }
    Ok(id)
}

#[tauri::command]
fn append_batch_items(app: AppHandle, batch_id: String, input_paths: Vec<String>) -> Result<(), String> {
    if input_paths.is_empty() { return Ok(()); }
    let database = connection(&app)?;
    let status: String = database.query_row("SELECT status FROM batch_jobs WHERE id = ?1", params![batch_id], |row| row.get(0)).map_err(|error| error.to_string())?;
    if status == "running" { return Err("Pause or wait for the active batch before adding files.".to_string()); }
    let offset: i64 = database.query_row("SELECT COUNT(*) FROM batch_items WHERE batch_id = ?1", params![batch_id], |row| row.get(0)).map_err(|error| error.to_string())?;
    let created_at = Utc::now().to_rfc3339();
    for (ordinal, path) in input_paths.iter().enumerate() {
        database.execute("INSERT INTO batch_items (id, batch_id, source_path, status, created_at, updated_at) VALUES (?1, ?2, ?3, 'queued', ?4, ?4)", params![format!("{batch_id}-{}", offset + ordinal as i64), batch_id, path, created_at]).map_err(|error| error.to_string())?;
    }
    database.execute("UPDATE batch_jobs SET status = 'queued', updated_at = ?1 WHERE id = ?2", params![created_at, batch_id]).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_batch_items(app: AppHandle, batch_id: String) -> Result<Vec<BatchItem>, String> {
    list_batch_items_for(&app, &batch_id)
}

#[tauri::command]
fn latest_batch(app: AppHandle) -> Result<Option<String>, String> {
    let database = connection(&app)?;
    database.query_row("SELECT id FROM batch_jobs WHERE status IN ('queued', 'running') ORDER BY updated_at DESC LIMIT 1", [], |row| row.get(0)).optional().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_batch_item_state(app: AppHandle, item_id: String, state: String) -> Result<(), String> {
    if !["queued", "paused", "cancelled"].contains(&state.as_str()) { return Err("Queue state must be queued, paused, or cancelled.".to_string()); }
    let database = connection(&app)?;
    database.execute("UPDATE batch_items SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status NOT IN ('completed', 'completed_with_warnings')", params![state, Utc::now().to_rfc3339(), item_id]).map_err(|error| error.to_string())?;
    Ok(())
}

fn run_batch_inner(app: AppHandle, state: &EngineState, batch_id: String, job_id: Option<String>) -> Result<Value, String> {
    let database = connection(&app)?;
    let (profile, cache_policy, saved_outputs): (String, Option<String>, Option<String>) = database.query_row("SELECT profile, cache_policy, outputs FROM batch_jobs WHERE id = ?1", params![batch_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).map_err(|error| error.to_string())?;
    let outputs: Vec<String> = saved_outputs.and_then(|json| serde_json::from_str(&json).ok()).filter(|items: &Vec<String>| !items.is_empty()).unwrap_or_else(|| vec!["machine".into(), "markdown".into(), "html".into(), "ir".into(), "chunks".into(), "evidence".into(), "table_csv".into(), "assets".into(), "manifest".into()]);
    let cache_policy = cache_policy.unwrap_or_else(|| "use".into());
    database.execute("UPDATE batch_jobs SET status = 'running', updated_at = ?1 WHERE id = ?2", params![Utc::now().to_rfc3339(), batch_id]).map_err(|error| error.to_string())?;
    drop(database);
    let candidates = list_batch_items_for(&app, &batch_id)?;
    let queued_total = candidates.iter().filter(|item| item.status == "queued").count().max(1);
    let mut results = Vec::new(); let mut failures = Vec::new();
    for (ordinal, item) in candidates.into_iter().filter(|item| item.status == "queued").enumerate() {
        let current_state: Option<String> = connection(&app)?.query_row("SELECT status FROM batch_items WHERE id = ?1", params![item.id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
        if current_state.as_deref() != Some("queued") { continue; }
        connection(&app)?.execute("UPDATE batch_items SET status = 'running', updated_at = ?1 WHERE id = ?2", params![Utc::now().to_rfc3339(), item.id]).map_err(|error| error.to_string())?;
        let _ = app.emit("batch-progress", json!({"batch_id": batch_id, "item_id": item.id, "status": "running"}));
        let _ = app.emit("conversion-progress", json!({"job_id": job_id, "current": ordinal + 1, "total": queued_total, "percent": ((ordinal * 100) / queued_total), "stage": "starting", "message": format!("Starting {}", item.source_path), "source_path": item.source_path}));
        let workspace = app_data(&app)?.to_string_lossy().to_string();
        match engine_call_with_progress(&app, &state, json!({"action": "convert", "config": {"input_paths": [item.source_path], "profile": profile, "workspace_dir": workspace, "outputs": outputs, "cache_policy": cache_policy, "local_repair": false, "job_id": job_id}}), |payload| {
            let file_percent = payload.get("percent").and_then(Value::as_u64).unwrap_or(0) as usize;
            let overall_percent = ((ordinal * 100) + file_percent) / queued_total;
            let mut aggregate = payload;
            aggregate["job_id"] = json!(job_id);
            aggregate["current"] = json!(ordinal + 1);
            aggregate["total"] = json!(queued_total);
            aggregate["percent"] = json!(overall_percent);
            let _ = app.emit("conversion-progress", aggregate);
        }) {
            Ok(payload) => {
                // A pause/cancel request cannot safely interrupt a bounded
                // converter call in the middle of a document, but it must
                // take effect before the result is published or the next
                // item begins. A retry will reuse Philon's local cache.
                let requested_state: Option<String> = connection(&app)?.query_row("SELECT status FROM batch_items WHERE id = ?1", params![item.id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
                if !publish_completed_batch_document(requested_state.as_deref()) {
                    let state = requested_state.unwrap_or_else(|| "cancelled".into());
                    let _ = app.emit("batch-progress", json!({"batch_id": batch_id, "item_id": item.id, "status": state}));
                    continue;
                }
                let document = payload.get("results").and_then(Value::as_array).and_then(|items| items.first()).cloned().ok_or("Engine returned no document result")?;
                let item_status = document.get("status").and_then(Value::as_str).unwrap_or("completed").to_string();
                connection(&app)?.execute("UPDATE batch_items SET status = ?1, result = ?2, updated_at = ?3 WHERE id = ?4", params![item_status, document.to_string(), Utc::now().to_rfc3339(), item.id]).map_err(|error| error.to_string())?;
                results.push(document);
                let _ = app.emit("batch-progress", json!({"batch_id": batch_id, "item_id": item.id, "status": item_status}));
            }
            Err(error) => {
                connection(&app)?.execute("UPDATE batch_items SET status = 'failed', error = ?1, updated_at = ?2 WHERE id = ?3", params![error, Utc::now().to_rfc3339(), item.id]).map_err(|db_error| db_error.to_string())?;
                failures.push(json!({"source_path": item.source_path, "error": error}));
                let _ = app.emit("batch-progress", json!({"batch_id": batch_id, "item_id": item.id, "status": "failed"}));
            }
        }
    }
    let payload = json!({"id": batch_id, "profile": profile, "local_only": true, "results": results, "failures": failures, "created_at": Utc::now().to_rfc3339()});
    let remaining: i64 = connection(&app)?.query_row("SELECT COUNT(*) FROM batch_items WHERE batch_id = ?1 AND status IN ('queued', 'paused', 'running')", params![batch_id], |row| row.get(0)).map_err(|error| error.to_string())?;
    let batch_status = batch_status_after_run(remaining);
    connection(&app)?.execute("UPDATE batch_jobs SET status = ?1, updated_at = ?2 WHERE id = ?3", params![batch_status, Utc::now().to_rfc3339(), batch_id]).map_err(|error| error.to_string())?;
    store_history(&app, &payload)?;
    Ok(payload)
}

fn list_jobs_inner(app: AppHandle) -> Result<Vec<JobHistory>, String> {
    let database = connection(&app)?;
    let mut statement = database
        .prepare("SELECT id, created_at, profile, status, documents, warnings FROM jobs ORDER BY created_at DESC LIMIT 50")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(JobHistory {
                id: row.get(0)?,
                created_at: row.get(1)?,
                profile: row.get(2)?,
                status: row.get(3)?,
                documents: row.get(4)?,
                warnings: row.get(5)?,
                payload: None,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

fn clear_library_inner(app: AppHandle) -> Result<usize, String> {
    connection(&app)?
        .execute("DELETE FROM jobs", [])
        .map_err(|error| error.to_string())
}

fn get_job_inner(app: AppHandle, job_id: String) -> Result<Value, String> {
    let database = connection(&app)?;
    let payload: String = database
        .query_row("SELECT payload FROM jobs WHERE id = ?1", params![job_id], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or("This local conversion is no longer available in the library.")?;
    serde_json::from_str(&payload).map_err(|error| format!("The stored conversion could not be read: {error}"))
}

#[tauri::command]
fn engine_health(app: AppHandle, state: State<'_, EngineState>) -> Result<Value, String> {
    engine_call(&app, &state, json!({"action": "health"}))
}

#[tauri::command]
fn apply_review(app: AppHandle, state: State<'_, EngineState>, review: ReviewAction) -> Result<Value, String> {
    engine_call(
        &app,
        &state,
        json!({
            "action": "review",
            "ir_path": review.ir_path,
            "block_id": review.block_id,
            "review_action": review.review_action,
            "text": review.text,
            "candidate_index": review.candidate_index,
        }),
    )
}

fn request_repair_inner(app: AppHandle, state: &EngineState, ir_path: String, block_id: String, repair_mode: Option<String>, job_id: Option<String>, enabled_model_ids: Option<Vec<String>>) -> Result<Value, String> {
    engine_call_with_progress(&app, &state, json!({"action": "repair", "ir_path": ir_path, "block_id": block_id, "repair_mode": repair_mode.unwrap_or_else(|| "transcription".into()), "job_id": job_id, "enabled_model_ids": enabled_model_ids.unwrap_or_default()}), |payload| {
        let _ = app.emit("conversion-progress", payload);
    })
}

fn export_conversion_inner(app: AppHandle, ir_path: String, destination_dir: String) -> Result<Value, String> {
    let exports_root = app_data(&app)?.join("exports").canonicalize().map_err(|_| "Philon's local export folder does not exist yet.".to_string())?;
    let ir_file = PathBuf::from(ir_path).canonicalize().map_err(|_| "The selected conversion export is no longer available locally.".to_string())?;
    let source_dir = ir_file.parent().ok_or("The selected IR export has no parent folder.")?.to_path_buf();
    if !source_dir.starts_with(&exports_root) || ir_file.extension().and_then(|extension| extension.to_str()) != Some("json") {
        return Err("Philon can export only a conversion created in this app's local export store.".to_string());
    }
    let destination = PathBuf::from(destination_dir);
    if !destination.is_dir() {
        return Err("Choose an existing folder for the exported conversion.".to_string());
    }
    let source_name = source_dir.file_name().and_then(|name| name.to_str()).unwrap_or("Philon export");
    let target = unique_export_target(&destination, source_name);
    // Copy into a sibling staging folder first, then rename it atomically.
    // A Finder destination therefore contains either a complete bundle or no
    // bundle at all if a removable volume fills up or a process is interrupted.
    let staging = destination.join(format!(".{source_name}.philon-exporting-{}", Utc::now().timestamp_micros()));
    if staging.exists() {
        return Err("Philon could not reserve a temporary export folder. Please try Export again.".to_string());
    }
    let files = match copy_export_directory(&source_dir, &staging) {
        Ok(files) => files,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Philon did not publish this incomplete export: {error}"));
        }
    };
    if let Err(error) = fs::rename(&staging, &target) {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Philon copied the conversion but could not publish it atomically: {error}"));
    }
    Ok(json!({"export_path": target, "files": files}))
}

/// Long-running filesystem and engine calls run on Tauri's blocking pool.
/// The webview stays free to paint progress events emitted by the worker.
fn join_blocking<T>(task: tauri::async_runtime::JoinHandle<Result<T, String>>) -> impl std::future::Future<Output = Result<T, String>> {
    async move { task.await.map_err(|error| format!("Philon's background task stopped unexpectedly: {error}"))? }
}

#[tauri::command]
async fn run_conversion(app: AppHandle, state: State<'_, EngineState>, config: JobConfig) -> Result<Value, String> {
    let worker_state = state.inner().clone();
    join_blocking(tauri::async_runtime::spawn_blocking(move || run_conversion_inner(app, &worker_state, config))).await
}

#[tauri::command]
async fn preflight_conversion(app: AppHandle, state: State<'_, EngineState>, config: JobConfig) -> Result<Value, String> {
    let worker_state = state.inner().clone();
    join_blocking(tauri::async_runtime::spawn_blocking(move || preflight_conversion_inner(app, &worker_state, config))).await
}

#[tauri::command]
async fn run_batch(app: AppHandle, state: State<'_, EngineState>, batch_id: String, job_id: Option<String>) -> Result<Value, String> {
    let worker_state = state.inner().clone();
    join_blocking(tauri::async_runtime::spawn_blocking(move || run_batch_inner(app, &worker_state, batch_id, job_id))).await
}

#[tauri::command]
async fn request_repair(app: AppHandle, state: State<'_, EngineState>, ir_path: String, block_id: String, repair_mode: Option<String>, job_id: Option<String>, enabled_model_ids: Option<Vec<String>>) -> Result<Value, String> {
    let worker_state = state.inner().clone();
    join_blocking(tauri::async_runtime::spawn_blocking(move || request_repair_inner(app, &worker_state, ir_path, block_id, repair_mode, job_id, enabled_model_ids))).await
}

#[tauri::command]
async fn export_conversion(app: AppHandle, ir_path: String, destination_dir: String) -> Result<Value, String> {
    join_blocking(tauri::async_runtime::spawn_blocking(move || export_conversion_inner(app, ir_path, destination_dir))).await
}

fn model_status_inner(app: AppHandle, state: &EngineState) -> Result<Value, String> {
    engine_call(&app, &state, json!({"action": "models"}))
}

#[tauri::command]
async fn list_jobs(app: AppHandle) -> Result<Vec<JobHistory>, String> {
    join_blocking(tauri::async_runtime::spawn_blocking(move || list_jobs_inner(app))).await
}

#[tauri::command]
async fn clear_library(app: AppHandle) -> Result<usize, String> {
    join_blocking(tauri::async_runtime::spawn_blocking(move || clear_library_inner(app))).await
}

#[tauri::command]
async fn get_job(app: AppHandle, job_id: String) -> Result<Value, String> {
    join_blocking(tauri::async_runtime::spawn_blocking(move || get_job_inner(app, job_id))).await
}

#[tauri::command]
async fn model_status(app: AppHandle, state: State<'_, EngineState>) -> Result<Value, String> {
    let worker_state = state.inner().clone();
    join_blocking(tauri::async_runtime::spawn_blocking(move || model_status_inner(app, &worker_state))).await
}

#[cfg(test)]
mod tests {
    use super::{batch_status_after_run, publish_completed_batch_document, session_token, stop_engine_process};
    use std::fs;
    use std::os::unix::process::CommandExt;
    use std::process::Command;
    use std::thread;
    use std::time::{Duration, Instant};

    /// Does a process still exist? Signal 0 performs the permission and
    /// existence checks without delivering anything.
    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn batch_pause_and_cancel_hold_the_current_document_at_publication_boundary() {
        assert!(!publish_completed_batch_document(Some("paused")));
        assert!(!publish_completed_batch_document(Some("cancelled")));
        assert!(publish_completed_batch_document(Some("running")));
        assert!(publish_completed_batch_document(None));
    }

    #[test]
    fn incomplete_batches_remain_discoverable_after_a_run() {
        assert_eq!(batch_status_after_run(2), "queued");
        assert_eq!(batch_status_after_run(0), "completed");
    }

    #[test]
    fn a_session_token_carries_the_full_entropy_the_bridge_authenticates_with() {
        let token = session_token().expect("Local entropy must be readable");
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|character| character.is_ascii_hexdigit()));
    }

    #[test]
    fn session_tokens_are_never_reused_between_runs() {
        let first = session_token().expect("Local entropy must be readable");
        let second = session_token().expect("Local entropy must be readable");
        assert_ne!(first, second);
    }

    /// The engine is a PyInstaller one-file binary: the process Philon spawns
    /// is a bootloader that runs the real interpreter as a child of its own.
    /// Stopping only the process we hold leaves that grandchild alive and
    /// reparented, still holding the engine socket, so this stands in a shell
    /// with a background sleep for the same shape.
    #[test]
    fn stopping_the_engine_takes_its_grandchild_with_it() {
        let record = std::env::temp_dir().join(format!("philon-test-grandchild-{}", std::process::id()));
        let _ = fs::remove_file(&record);
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(format!("sleep 30 & echo $! > {}; wait", record.display()));
        command.process_group(0);
        let mut child = command.spawn().expect("The stand-in engine must start");

        // The grandchild's pid is written by the shell, so wait for the file
        // rather than assuming how quickly it was scheduled.
        let deadline = Instant::now() + Duration::from_secs(5);
        let grandchild = loop {
            if let Ok(text) = fs::read_to_string(&record) {
                if let Ok(pid) = text.trim().parse::<i32>() {
                    break pid;
                }
            }
            assert!(Instant::now() < deadline, "The stand-in engine never reported its grandchild");
            thread::sleep(Duration::from_millis(20));
        };
        assert!(alive(grandchild), "The grandchild must be running before it can be left behind");

        stop_engine_process(&mut child);

        let deadline = Instant::now() + Duration::from_secs(5);
        while alive(grandchild) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(!alive(grandchild), "The grandchild outlived the process Philon spawned");
        let _ = fs::remove_file(&record);
    }

    /// A child that shares this process's group must never be signalled by
    /// group: that group contains the test runner, and in production it would
    /// contain Philon itself.
    #[test]
    fn a_child_without_its_own_group_is_signalled_alone() {
        let own_group = unsafe { libc::getpgrp() };
        let mut child = Command::new("/bin/sh").arg("-c").arg("sleep 30").spawn().expect("The stand-in engine must start");
        assert_eq!(unsafe { libc::getpgid(child.id() as i32) }, own_group, "This child is expected to share the runner's group");

        stop_engine_process(&mut child);

        assert!(alive(unsafe { libc::getpid() }), "Stopping a grouped-with-us child must not signal this process");
    }
}

/// Keep the application commands in the macOS menu bar. The web workspace
/// listens for the matching `menu-command` events, so menu selection and its
/// on-canvas counterpart always perform the same action.
fn install_native_menu(app: &AppHandle) -> tauri::Result<()> {
    let open_document = MenuItemBuilder::with_id("file-open", "Open PDF or Image…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let add_to_batch = MenuItemBuilder::with_id("file-add-batch", "Add Documents to Batch…")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let export_conversion = MenuItemBuilder::with_id("file-export", "Export Conversion…")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let single_job = MenuItemBuilder::with_id("view-single-job", "Single Job")
        .accelerator("CmdOrCtrl+1")
        .build(app)?;
    let batch = MenuItemBuilder::with_id("view-batch", "Batch")
        .accelerator("CmdOrCtrl+2")
        .build(app)?;
    let library = MenuItemBuilder::with_id("view-library", "Library")
        .accelerator("CmdOrCtrl+3")
        .build(app)?;
    let diagnostics = MenuItemBuilder::with_id("view-diagnostics", "Diagnostics")
        .accelerator("CmdOrCtrl+4")
        .build(app)?;
    let preferences = MenuItemBuilder::with_id("view-settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let app_menu = SubmenuBuilder::new(app, "Philon")
        .about(None)
        .item(&preferences)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let close_window = PredefinedMenuItem::close_window(app, None)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_document)
        .item(&add_to_batch)
        .separator()
        .item(&export_conversion)
        .separator()
        .item(&close_window)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&single_job)
        .item(&batch)
        .separator()
        .item(&library)
        .item(&diagnostics)
        .build()?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&minimize)
        .item(&fullscreen)
        .separator()
        .bring_all_to_front()
        .build()?;
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;
    app.set_menu(menu).map(|_| ())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState {
            socket_path: std::env::temp_dir().join(format!("philon-{}-engine.sock", std::process::id())),
            auth_token: session_token().expect("Secure local engine session token must be available"),
            child: Arc::new(Mutex::new(None)),
        })
        .setup(|app| {
            recover_interrupted_batches(&app.handle()).map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            install_native_menu(&app.handle()).map_err(|error| -> Box<dyn std::error::Error> { error.into() })?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let command = event.id().0.as_str();
            if matches!(command, "file-open" | "file-add-batch" | "file-export" | "view-single-job" | "view-batch" | "view-library" | "view-diagnostics" | "view-settings") {
                let _ = app.emit("menu-command", command);
            }
        })
        .invoke_handler(tauri::generate_handler![run_conversion, preflight_conversion, enqueue_batch, append_batch_items, list_batch_items, latest_batch, set_batch_item_state, run_batch, list_jobs, clear_library, get_job, engine_health, apply_review, request_repair, export_conversion, model_status])
        .build(tauri::generate_context!())
        .expect("error while building Philon")
        // Quitting is the moment the engine would otherwise be orphaned, so the
        // application is built and run explicitly rather than through `run()`.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                shutdown_engine(&app.state::<EngineState>());
            }
        });
}
