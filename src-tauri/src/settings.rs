use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub permission_mode: String,
    pub workspace: Option<String>,
    #[serde(default)]
    pub allows: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            provider: "openai".into(),
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            model: "gpt-6.1-sol".into(),
            permission_mode: "ask".into(),
            workspace: None,
            allows: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub permission_mode: String,
    pub workspace: Option<String>,
    pub has_api_key: bool,
    pub allows: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub provider: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub permission_mode: String,
}

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("无法定位配置目录: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建配置目录: {err}"))?;
    dir.canonicalize()
        .map_err(|err| format!("无法解析配置目录: {err}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let Ok(path) = settings_path(app) else {
        return Settings::default();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Settings::default();
    };
    let mut settings: Settings = serde_json::from_str(&text).unwrap_or_default();
    if replace_retired_model(&mut settings) {
        if let Ok(body) = serde_json::to_string_pretty(&settings) {
            let _ = fs::write(path, body);
        }
    }
    settings
}

fn replace_retired_model(settings: &mut Settings) -> bool {
    let next = match settings.model.trim() {
        "gpt-4.1" => "gpt-6.1-sol",
        "deepseek-chat" | "deepseek-reasoner" => "deepseek-flash",
        "qwen2.5-coder" => "qwen3-coder",
        "openai/gpt-4.1" => "anthropic/claude-sonnet-5.5",
        _ => return false,
    };
    settings.model = next.to_string();
    true
}

pub fn save(app: &AppHandle, patch: SettingsPatch) -> Result<Settings, String> {
    let mut current = load(app);
    current.provider = patch.provider.trim().to_string();
    current.base_url = patch.base_url.trim().trim_end_matches('/').to_string();
    current.model = patch.model.trim().to_string();
    current.permission_mode = normalize_mode(&patch.permission_mode);

    if current.base_url.is_empty() {
        return Err("接口地址不能为空".into());
    }
    if current.model.is_empty() {
        return Err("模型名不能为空".into());
    }

    if let Some(key) = patch.api_key {
        let key = key.trim().to_string();
        if !key.is_empty() {
            current.api_key = key;
        }
    }

    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(&current).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("无法保存设置: {err}"))?;
    Ok(current)
}

pub fn save_workspace(app: &AppHandle, workspace: Option<String>) -> Result<(), String> {
    let mut current = load(app);
    current.workspace = workspace;
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(&current).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("无法保存工作区: {err}"))?;
    Ok(())
}

pub fn publish(settings: &Settings) -> PublicSettings {
    PublicSettings {
        provider: settings.provider.clone(),
        base_url: settings.base_url.clone(),
        model: settings.model.clone(),
        permission_mode: normalize_mode(&settings.permission_mode),
        workspace: settings.workspace.clone(),
        has_api_key: !settings.api_key.trim().is_empty(),
        allows: settings.allows.clone(),
    }
}

pub fn grant_allow(app: &AppHandle, key: &str) -> Result<Vec<String>, String> {
    let key = key.trim();
    if key.len() > 500 || !(key.starts_with("command:") || key.starts_with("file:")) {
        return Err("这条允许规则无效".into());
    }
    let mut current = load(app);
    if !current.allows.iter().any(|item| item == key) {
        current.allows.push(key.to_string());
        if current.allows.len() > 200 {
            let extra = current.allows.len() - 200;
            current.allows.drain(0..extra);
        }
        let path = settings_path(app)?;
        let text = serde_json::to_string_pretty(&current).map_err(|err| err.to_string())?;
        fs::write(path, text).map_err(|err| format!("无法保存允许规则: {err}"))?;
    }
    Ok(current.allows)
}

pub fn normalize_mode(mode: &str) -> String {
    match mode {
        "auto_edit" | "full" => mode.to_string(),
        _ => "ask".into(),
    }
}
