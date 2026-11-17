mod broker;
mod fs_tools;
mod llm;
mod market;
mod memory;
mod sandbox;
mod skills;
mod settings;
mod shell;

use fs_tools::{EditFileResult, GlobResult, GrepResult, ReadFileResult, WriteFileResult};
use market::{PaperAccount, PaperOrderResult, PriceAlert, SecurityHistory, SecurityQuote, SecuritySearch, WatchItem};
use llm::{CompletionResult, StreamEvent};
use serde_json::Value;
use settings::{PublicSettings, SettingsPatch};
use shell::CommandOutput;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub cancel: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace: Mutex::new(None),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

fn workspace_root(state: &AppState) -> Result<PathBuf, String> {
    state
        .workspace
        .lock()
        .map_err(|_| "状态锁损坏".to_string())?
        .clone()
        .ok_or_else(|| "还没有打开工作区".to_string())
}

fn protected_dirs(app: &AppHandle) -> Vec<PathBuf> {
    settings::config_dir(app).into_iter().collect()
}

#[tauri::command]
fn get_settings(app: AppHandle) -> PublicSettings {
    settings::publish(&settings::load(&app))
}

#[tauri::command]
fn save_settings(app: AppHandle, patch: SettingsPatch) -> Result<PublicSettings, String> {
    let saved = settings::save(&app, patch)?;
    Ok(settings::publish(&saved))
}

#[tauri::command]
fn get_workspace(state: State<AppState>) -> Option<String> {
    state
        .workspace
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
        .map(|path| path.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

#[tauri::command]
fn set_workspace(app: AppHandle, state: State<AppState>, path: String) -> Result<String, String> {
    let raw = PathBuf::from(path.trim());
    if !raw.is_dir() {
        return Err("请选择一个文件夹".into());
    }
    let canon = raw
        .canonicalize()
        .map_err(|err| format!("无法打开文件夹: {err}"))?;
    let display = canon.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    {
        let mut slot = state
            .workspace
            .lock()
            .map_err(|_| "状态锁损坏".to_string())?;
        *slot = Some(canon);
    }
    settings::save_workspace(&app, Some(display.clone()))?;
    Ok(display)
}

#[tauri::command]
fn project_instructions(state: State<AppState>) -> Result<Option<memory::ProjectNote>, String> {
    let Ok(root) = workspace_root(&state) else {
        return Ok(None);
    };
    memory::project_instructions(&root)
}

#[tauri::command]
fn memory_index(app: AppHandle, workspace: Option<String>) -> Result<String, String> {
    memory::memory_index(&app, workspace.as_deref())
}

#[tauri::command]
fn read_memory_note(app: AppHandle, workspace: Option<String>) -> Result<String, String> {
    memory::read_memory(&app, workspace.as_deref())
}

#[tauri::command]
fn remember_note(app: AppHandle, workspace: Option<String>, note: String) -> Result<String, String> {
    memory::remember(&app, workspace.as_deref(), &note)
}

#[tauri::command]
fn skill_index(app: AppHandle, state: State<AppState>, workspace: Option<String>) -> Result<String, String> {
    skills::skill_index(&app, skill_workspace(&state, workspace.as_deref()).as_deref())
}

#[tauri::command]
fn read_skill(
    app: AppHandle,
    state: State<AppState>,
    workspace: Option<String>,
    name: String,
) -> Result<String, String> {
    skills::read_skill(
        &app,
        skill_workspace(&state, workspace.as_deref()).as_deref(),
        &name,
    )
}

#[tauri::command]
fn list_skills(
    app: AppHandle,
    state: State<AppState>,
    workspace: Option<String>,
) -> Result<Vec<skills::SkillEntry>, String> {
    skills::list_skills(&app, skill_workspace(&state, workspace.as_deref()).as_deref())
}

#[tauri::command]
fn save_skill(
    app: AppHandle,
    name: String,
    description: String,
    body: String,
    previous_folder: Option<String>,
) -> Result<(), String> {
    skills::save_skill(&app, &name, &description, &body, previous_folder.as_deref())
}

#[tauri::command]
fn delete_skill(app: AppHandle, folder: String) -> Result<(), String> {
    skills::delete_skill(&app, &folder)
}

fn skill_workspace(state: &AppState, workspace: Option<&str>) -> Option<PathBuf> {
    let marked = workspace.map(str::trim).is_some_and(|value| !value.is_empty());
    if !marked {
        return None;
    }
    workspace_root(state).ok()
}

#[tauri::command]
fn grant_allow(app: AppHandle, key: String) -> Result<Vec<String>, String> {
    settings::grant_allow(&app, &key)
}

#[tauri::command]
fn begin_turn(state: State<AppState>) {
    state.cancel.store(false, Ordering::Relaxed);
}

#[tauri::command]
fn cancel_completion(state: State<AppState>) {
    state.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn read_picked_file(app: AppHandle, path: String) -> Result<String, String> {
    fs_tools::read_picked(&protected_dirs(&app), &path)
}

#[tauri::command]
fn read_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ReadFileResult, String> {
    let root = workspace_root(&state)?;
    fs_tools::read_file(&root, &protected_dirs(&app), &path, offset, limit)
}

#[tauri::command]
fn write_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    content: String,
) -> Result<WriteFileResult, String> {
    let root = workspace_root(&state)?;
    fs_tools::write_file(&root, &protected_dirs(&app), &path, &content)
}

#[tauri::command]
fn delete_file(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    fs_tools::delete_file(&root, &protected_dirs(&app), &path)
}

#[tauri::command]
fn edit_file(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
) -> Result<EditFileResult, String> {
    let root = workspace_root(&state)?;
    fs_tools::edit_file(
        &root,
        &protected_dirs(&app),
        &path,
        &old_string,
        &new_string,
        replace_all.unwrap_or(false),
    )
}

#[tauri::command]
fn list_dir(
    app: AppHandle,
    state: State<AppState>,
    path: Option<String>,
) -> Result<Vec<fs_tools::DirEntry>, String> {
    let root = workspace_root(&state)?;
    fs_tools::list_dir(&root, &protected_dirs(&app), path.as_deref().unwrap_or("."))
}

#[tauri::command]
fn grep_workspace(
    app: AppHandle,
    state: State<AppState>,
    pattern: String,
    path: Option<String>,
    glob: Option<String>,
) -> Result<GrepResult, String> {
    let root = workspace_root(&state)?;
    fs_tools::grep(
        &root,
        &protected_dirs(&app),
        &pattern,
        path.as_deref().unwrap_or("."),
        glob.as_deref(),
    )
}

#[tauri::command]
fn glob_workspace(
    app: AppHandle,
    state: State<AppState>,
    pattern: String,
) -> Result<GlobResult, String> {
    let root = workspace_root(&state)?;
    fs_tools::glob_files(&root, &protected_dirs(&app), &pattern)
}

#[tauri::command]
async fn run_command(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    cwd: Option<String>,
    timeout_sec: Option<u64>,
) -> Result<CommandOutput, String> {
    let root = workspace_root(&state)?;
    let protected = protected_dirs(&app);
    shell::run_command(&root, &protected, &command, cwd.as_deref(), timeout_sec).await
}

#[tauri::command]
async fn complete_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    messages: Vec<Value>,
    tools: Vec<Value>,
    on_event: Channel<StreamEvent>,
) -> Result<CompletionResult, String> {
    let cancel = Arc::clone(&state.cancel);
    let settings = settings::load(&app);
    llm::complete(&settings, messages, tools, on_event, cancel).await
}

#[tauri::command]
async fn search_securities(query: String) -> Result<SecuritySearch, String> {
    market::search(&query).await
}

#[tauri::command]
async fn quote_security(secid: String) -> Result<SecurityQuote, String> {
    market::quote(&secid).await
}

#[tauri::command]
async fn security_history(secid: String, days: Option<u32>) -> Result<SecurityHistory, String> {
    market::history(&secid, days).await
}

#[tauri::command]
async fn paper_account(app: AppHandle) -> Result<PaperAccount, String> {
    market::account(&app).await
}

#[tauri::command]
async fn list_price_alerts(app: AppHandle) -> Result<Vec<PriceAlert>, String> {
    market::list_alerts(&app)
}

#[tauri::command]
async fn add_price_alert(
    app: AppHandle,
    query: Option<String>,
    secid: Option<String>,
    kind: String,
    price: Option<f64>,
    low: Option<f64>,
    high: Option<f64>,
    note: Option<String>,
    side: Option<String>,
    quantity: Option<f64>,
) -> Result<PriceAlert, String> {
    market::add_alert(
        &app,
        query.as_deref(),
        secid.as_deref(),
        &kind,
        price,
        low,
        high,
        note.as_deref().unwrap_or(""),
        side.as_deref().unwrap_or(""),
        quantity,
    )
    .await
}

#[tauri::command]
async fn remove_price_alert(app: AppHandle, id: String) -> Result<(), String> {
    market::remove_alert(&app, &id)
}

#[tauri::command]
async fn check_price_alerts(app: AppHandle) -> Result<Vec<PriceAlert>, String> {
    market::check_alerts(&app).await
}

#[tauri::command]
fn list_watch(app: AppHandle) -> Result<Vec<WatchItem>, String> {
    market::list_watch(&app)
}

#[tauri::command]
async fn add_watch(app: AppHandle, query: Option<String>, secid: Option<String>) -> Result<WatchItem, String> {
    market::add_watch(&app, query.as_deref(), secid.as_deref()).await
}

#[tauri::command]
fn remove_watch(app: AppHandle, secid: String) -> Result<(), String> {
    market::remove_watch(&app, &secid)
}

#[tauri::command]
async fn paper_order(
    app: AppHandle,
    query: Option<String>,
    secid: Option<String>,
    side: String,
    quantity: f64,
) -> Result<PaperOrderResult, String> {
    market::order(
        &app,
        query.as_deref(),
        secid.as_deref(),
        &side,
        quantity,
    )
    .await
}

#[tauri::command]
async fn test_connection(app: AppHandle) -> Result<String, String> {
    llm::test_connection(&settings::load(&app)).await
}

#[tauri::command]
fn get_broker(app: AppHandle) -> broker::PublicBroker {
    broker::publish(&broker::load(&app))
}

#[tauri::command]
fn save_broker(app: AppHandle, patch: broker::BrokerPatch) -> Result<broker::PublicBroker, String> {
    Ok(broker::publish(&broker::save(&app, patch)?))
}

#[tauri::command]
async fn broker_status(app: AppHandle) -> Result<broker::BrokerStatus, String> {
    broker::status(&app).await
}

#[tauri::command]
async fn broker_account(app: AppHandle) -> Result<broker::BrokerAccount, String> {
    broker::account(&app).await
}

#[tauri::command]
async fn broker_order(
    app: AppHandle,
    query: Option<String>,
    secid: Option<String>,
    side: String,
    quantity: f64,
    price: f64,
) -> Result<broker::BrokerOrderResult, String> {
    broker::order(
        &app,
        query.as_deref().unwrap_or(""),
        secid.as_deref().unwrap_or(""),
        &side,
        quantity,
        price,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let settings = settings::load(app.handle());
            if let Some(path) = settings.workspace {
                let raw = PathBuf::from(&path);
                if raw.is_dir() {
                    if let Ok(canon) = raw.canonicalize() {
                        if let Ok(mut slot) = app.state::<AppState>().workspace.lock() {
                            *slot = Some(canon);
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_workspace,
            set_workspace,
            begin_turn,
            cancel_completion,
            project_instructions,
            memory_index,
            read_memory_note,
            remember_note,
            skill_index,
            read_skill,
            list_skills,
            save_skill,
            delete_skill,
            grant_allow,
            read_file,
            read_picked_file,
            write_file,
            delete_file,
            edit_file,
            list_dir,
            grep_workspace,
            glob_workspace,
            run_command,
            search_securities,
            quote_security,
            security_history,
            paper_account,
            paper_order,
            list_price_alerts,
            add_price_alert,
            remove_price_alert,
            check_price_alerts,
            list_watch,
            add_watch,
            remove_watch,
            get_broker,
            save_broker,
            broker_status,
            broker_account,
            broker_order,
            complete_chat,
            test_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
