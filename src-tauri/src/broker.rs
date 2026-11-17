use crate::market;
use crate::settings;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const BRIDGE_SCRIPT: &str = include_str!("../broker/qmt_bridge.py");
const WAIT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerConfig {
    #[serde(default = "none_kind")]
    kind: String,
    #[serde(default)]
    account: String,
    #[serde(default)]
    qmt_path: String,
    #[serde(default)]
    python_path: String,
    #[serde(default)]
    command_path: String,
    #[serde(default)]
    secret: String,
}

fn none_kind() -> String {
    "none".into()
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            kind: "none".into(),
            account: String::new(),
            qmt_path: String::new(),
            python_path: String::new(),
            command_path: String::new(),
            secret: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicBroker {
    pub kind: String,
    pub account: String,
    pub qmt_path: String,
    pub python_path: String,
    pub command_path: String,
    pub has_secret: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerPatch {
    pub kind: String,
    pub account: String,
    pub qmt_path: String,
    pub python_path: String,
    pub command_path: String,
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerStatus {
    pub connected: bool,
    pub kind: String,
    pub account: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerPosition {
    pub code: String,
    pub name: String,
    pub quantity: f64,
    pub available: f64,
    pub cost: f64,
    pub market_value: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerAccount {
    pub account: String,
    pub cash: f64,
    pub total: f64,
    pub market_value: f64,
    pub positions: Vec<BrokerPosition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerOrderResult {
    pub order_id: String,
    pub side: String,
    pub symbol: String,
    pub code: String,
    pub name: String,
    pub quantity: f64,
    pub price: f64,
}

struct OrderSpec {
    symbol: String,
    side: String,
    quantity: f64,
    price: f64,
}

struct TempPair {
    request: PathBuf,
    result: PathBuf,
}

impl Drop for TempPair {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.request);
        let _ = fs::remove_file(&self.result);
    }
}

fn bridge_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().map_err(|_| "券商连接锁损坏".to_string())
}

fn broker_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(settings::config_dir(app)?.join("broker.json"))
}

pub(crate) fn load(app: &AppHandle) -> BrokerConfig {
    let Ok(path) = broker_path(app) else {
        return BrokerConfig::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return BrokerConfig::default();
    };
    let mut config: BrokerConfig = serde_json::from_str(&text).unwrap_or_default();
    config.kind = normalize_kind(&config.kind);
    config
}

pub(crate) fn save(app: &AppHandle, patch: BrokerPatch) -> Result<BrokerConfig, String> {
    let mut current = load(app);
    current.kind = normalize_kind(&patch.kind);
    current.account = patch.account.trim().to_string();
    current.qmt_path = clean_path(&patch.qmt_path)?;
    current.python_path = clean_path(&patch.python_path)?;
    current.command_path = clean_path(&patch.command_path)?;
    if current.account.chars().count() > 32 {
        return Err("资金账号过长".into());
    }
    if let Some(secret) = patch.secret {
        let secret = secret.trim().to_string();
        if !secret.is_empty() {
            if secret.chars().count() > 4000 {
                return Err("密钥过长".into());
            }
            current.secret = secret;
        }
    }
    let path = broker_path(app)?;
    let text = serde_json::to_string_pretty(&current).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("无法保存券商设置: {err}"))?;
    Ok(current)
}

pub(crate) fn publish(config: &BrokerConfig) -> PublicBroker {
    PublicBroker {
        kind: normalize_kind(&config.kind),
        account: config.account.clone(),
        qmt_path: config.qmt_path.clone(),
        python_path: config.python_path.clone(),
        command_path: config.command_path.clone(),
        has_secret: !config.secret.trim().is_empty(),
    }
}

pub async fn status(app: &AppHandle) -> Result<BrokerStatus, String> {
    let config = load(app);
    if config.kind == "none" {
        return Ok(BrokerStatus {
            connected: false,
            kind: "none".into(),
            account: String::new(),
            message: "还没有连接券商".into(),
        });
    }
    let kind = config.kind.clone();
    let account = config.account.clone();
    let value = spawn_call(app, "status", None).await?;
    Ok(status_from(&kind, &account, &value))
}

pub async fn account(app: &AppHandle) -> Result<BrokerAccount, String> {
    let config = load(app);
    if config.kind == "none" {
        return Err("还没有连接券商".into());
    }
    let account = config.account.clone();
    let value = spawn_call(app, "account", None).await?;
    Ok(account_from(&account, &value))
}

pub async fn order(
    app: &AppHandle,
    query: &str,
    secid: &str,
    side: &str,
    quantity: f64,
    price: f64,
) -> Result<BrokerOrderResult, String> {
    let config = load(app);
    if config.kind == "none" {
        return Err("还没有连接券商".into());
    }
    let buying = match side.trim() {
        "buy" | "买入" => true,
        "sell" | "卖出" => false,
        _ => return Err("side 只能是 buy 或 sell".into()),
    };
    let prepared = market::prepare_live_order(query, secid, buying, quantity, price).await?;
    let spec = OrderSpec {
        symbol: prepared.symbol.clone(),
        side: if buying { "buy" } else { "sell" }.into(),
        quantity: quantity.round(),
        price,
    };
    let side_name = spec.side.clone();
    let value = spawn_call(app, "order", Some(spec)).await?;
    let order_id = json_string(&value, "orderId");
    if order_id.is_empty() {
        return Err("券商拒绝了这笔委托".into());
    }
    Ok(BrokerOrderResult {
        order_id,
        side: side_name,
        symbol: prepared.symbol,
        code: prepared.code,
        name: prepared.name,
        quantity: quantity.round(),
        price,
    })
}

async fn spawn_call(app: &AppHandle, cmd: &str, order: Option<OrderSpec>) -> Result<Value, String> {
    let app = app.clone();
    let cmd = cmd.to_string();
    tauri::async_runtime::spawn_blocking(move || call(&app, &cmd, order))
        .await
        .map_err(|err| format!("券商调用中断: {err}"))?
}

fn call(app: &AppHandle, cmd: &str, order: Option<OrderSpec>) -> Result<Value, String> {
    let _guard = bridge_lock()?;
    let config = load(app);
    match config.kind.as_str() {
        "qmt" => call_qmt(app, &config, cmd, order),
        "openapi" | "client" => call_command(app, &config, cmd, order),
        _ => Err("还没有连接券商".into()),
    }
}

fn call_qmt(app: &AppHandle, config: &BrokerConfig, cmd: &str, order: Option<OrderSpec>) -> Result<Value, String> {
    require_account(config)?;
    let userdata = PathBuf::from(config.qmt_path.trim());
    if !userdata.is_dir() {
        return Err(if config.qmt_path.trim().is_empty() {
            "请填写 QMT 的 userdata_mini 目录".into()
        } else {
            "userdata_mini 目录不存在".into()
        });
    }
    let python = qmt_python(&config.python_path, &userdata)?;
    let dir = settings::config_dir(app)?;
    let script = dir.join("qmt_bridge.py");
    fs::write(&script, BRIDGE_SCRIPT).map_err(|err| format!("无法写入券商脚本: {err}"))?;
    let pair = temp_pair(&dir)?;
    write_request(&pair.request, config, cmd, order.as_ref(), false)?;
    let cwd = python.parent().unwrap_or(Path::new("."));
    let ran = run_program(&python, cwd, &[script, pair.request.clone(), pair.result.clone()]);
    finish(&pair.result, &config.secret, ran)
}

fn call_command(app: &AppHandle, config: &BrokerConfig, cmd: &str, order: Option<OrderSpec>) -> Result<Value, String> {
    require_account(config)?;
    let program = PathBuf::from(config.command_path.trim());
    if !program.is_file() {
        return Err(if config.command_path.trim().is_empty() {
            "请填写交易程序路径".into()
        } else {
            "交易程序不存在".into()
        });
    }
    let dir = settings::config_dir(app)?;
    let pair = temp_pair(&dir)?;
    write_request(&pair.request, config, cmd, order.as_ref(), true)?;
    let cwd = program.parent().unwrap_or(Path::new("."));
    let ran = run_program(&program, cwd, &[pair.request.clone(), pair.result.clone()]);
    finish(&pair.result, &config.secret, ran)
}

fn finish(result: &Path, secret: &str, ran: Result<(), String>) -> Result<Value, String> {
    if result.is_file() {
        return read_bridge(result, secret);
    }
    Err(ran.err().unwrap_or_else(|| "券商没有返回结果".to_string()))
}

fn write_request(
    path: &Path,
    config: &BrokerConfig,
    cmd: &str,
    order: Option<&OrderSpec>,
    include_secret: bool,
) -> Result<(), String> {
    let mut body = json!({
        "cmd": cmd,
        "channel": config.kind,
        "account": config.account.trim(),
        "accountType": "STOCK",
    });
    if config.kind == "qmt" {
        body["path"] = json!(config.qmt_path.trim());
    }
    if include_secret && !config.secret.trim().is_empty() {
        body["secret"] = json!(config.secret.trim());
    }
    if let Some(order) = order {
        body["code"] = json!(order.symbol);
        body["side"] = json!(order.side);
        body["quantity"] = json!(order.quantity.round() as i64);
        body["price"] = json!(order.price);
    }
    let text = serde_json::to_string(&body).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("无法写入券商请求: {err}"))
}

fn read_bridge(path: &Path, secret: &str) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|_| "券商没有返回结果".to_string())?;
    let value: Value = serde_json::from_str(text.trim().trim_start_matches('\u{feff}'))
        .map_err(|_| "券商返回的内容无法解析".to_string())?;
    let ok = value.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if !ok {
        let error = json_string(&value, "error");
        let error = if error.is_empty() {
            "券商没有返回结果".into()
        } else {
            scrub(error, secret)
        };
        return Err(error);
    }
    Ok(value)
}

fn run_program(program: &Path, cwd: &Path, args: &[PathBuf]) -> Result<(), String> {
    let mut command = hidden(program);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|err| format!("无法启动交易程序: {err}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() || args.last().is_some_and(|path| path.is_file()) {
                    return Ok(());
                }
                return Err("交易程序退出了".into());
            }
            Ok(None) => {
                if started.elapsed() > WAIT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("券商终端没有在时限内响应".into());
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(format!("无法启动交易程序: {err}")),
        }
    }
}

fn status_from(kind: &str, account: &str, value: &Value) -> BrokerStatus {
    let connected = value.get("connected").and_then(Value::as_bool).unwrap_or(true);
    let message = if connected {
        "券商已连接".into()
    } else {
        let text = json_string(value, "message");
        if text.is_empty() { "还没有连接券商".into() } else { text }
    };
    BrokerStatus {
        connected,
        kind: kind.into(),
        account: if connected { account.into() } else { String::new() },
        message,
    }
}

fn account_from(account: &str, value: &Value) -> BrokerAccount {
    let positions = value
        .get("positions")
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter_map(parse_position).collect())
        .unwrap_or_default();
    BrokerAccount {
        account: account.into(),
        cash: json_f64(value, "cash"),
        total: json_f64(value, "total"),
        market_value: json_f64(value, "marketValue"),
        positions,
    }
}

fn parse_position(value: &Value) -> Option<BrokerPosition> {
    let code = json_string(value, "code");
    if code.is_empty() {
        return None;
    }
    Some(BrokerPosition {
        code,
        name: json_string(value, "name"),
        quantity: json_f64(value, "quantity"),
        available: json_f64(value, "available"),
        cost: json_f64(value, "cost"),
        market_value: json_f64(value, "marketValue"),
    })
}

fn qmt_python(configured: &str, userdata: &Path) -> Result<PathBuf, String> {
    if !configured.trim().is_empty() {
        let path = PathBuf::from(configured.trim());
        if path.is_file() {
            return Ok(path);
        }
        return Err("找不到填写的 python.exe".into());
    }
    let Some(root) = userdata.parent() else {
        return Err("找不到 QMT 的 python.exe".into());
    };
    for candidate in [
        root.join("bin.x64").join("python.exe"),
        root.join("python.exe"),
        root.join("bin").join("python.exe"),
    ] {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err("找不到 QMT 的 python.exe".into())
}

fn require_account(config: &BrokerConfig) -> Result<(), String> {
    if config.account.trim().is_empty() {
        return Err("请填写资金账号".into());
    }
    Ok(())
}

fn temp_pair(dir: &Path) -> Result<TempPair, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Ok(TempPair {
        request: dir.join(format!("broker-request-{stamp}.json")),
        result: dir.join(format!("broker-result-{stamp}.json")),
    })
}

fn normalize_kind(kind: &str) -> String {
    match kind.trim() {
        "qmt" | "openapi" | "client" => kind.trim().to_string(),
        _ => "none".into(),
    }
}

fn clean_path(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.contains(['\n', '\r']) || value.chars().count() > 400 {
        return Err("路径无效".into());
    }
    Ok(value.to_string())
}

fn scrub(text: String, secret: &str) -> String {
    let secret = secret.trim();
    if secret.chars().count() < 4 {
        return text;
    }
    text.replace(secret, "******")
}

fn json_string(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Number(number)) => number.to_string(),
        _ => String::new(),
    }
}

fn json_f64(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(0.0)
}

#[allow(unused_mut)]
fn hidden(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}
