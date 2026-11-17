use crate::settings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::Mutex;
use tauri::AppHandle;

const SEARCH_TOKEN: &str = "D43BF722C8E33BDC906FB84D85E326E8";
const STARTING_CASH: f64 = 100_000.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityHit {
    pub code: String,
    pub name: String,
    pub kind: String,
    pub secid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySearch {
    pub items: Vec<SecurityHit>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityQuote {
    pub secid: String,
    pub code: String,
    pub name: String,
    pub price: f64,
    pub change: f64,
    pub change_pct: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub prev_close: f64,
    pub volume: f64,
    pub amount: f64,
    pub turnover: Option<f64>,
    pub pe: Option<f64>,
    pub market_cap: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBar {
    pub date: String,
    pub open: f64,
    pub close: f64,
    pub high: f64,
    pub low: f64,
    pub change_pct: f64,
    pub amount: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityHistory {
    pub secid: String,
    pub code: String,
    pub name: String,
    pub bars: Vec<DailyBar>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperPosition {
    pub secid: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub quantity: f64,
    pub cost: f64,
    pub price: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperAccount {
    pub cash: f64,
    pub positions: Vec<PaperPosition>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperOrderResult {
    pub side: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub quantity: f64,
    pub price: f64,
    pub account: PaperAccount,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Book {
    cash: f64,
    positions: Vec<StoredPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredPosition {
    secid: String,
    code: String,
    name: String,
    kind: String,
    quantity: f64,
    cost: f64,
}

impl Default for Book {
    fn default() -> Self {
        Self {
            cash: STARTING_CASH,
            positions: Vec::new(),
        }
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|err| format!("无法创建行情客户端: {err}"))
}

fn paper_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().map_err(|_| "模拟账户锁损坏".to_string())
}

pub async fn search(query: &str) -> Result<SecuritySearch, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("请提供名称或代码".into());
    }
    let http = client()?;
    let mut items = suggest(&http, query).await?;
    if wants_bonds(query) {
        let bonds = convertibles(&http, query).await.unwrap_or_default();
        for hit in bonds {
            if !items.iter().any(|item| item.secid == hit.secid) {
                items.push(hit);
            }
        }
    }
    let truncated = items.len() > 8;
    items.truncate(8);
    Ok(SecuritySearch { items, truncated })
}

pub async fn quote(secid: &str) -> Result<SecurityQuote, String> {
    let secid = valid_secid(secid)?;
    let http = client()?;
    let row = quote_row(&http, &secid).await?;
    row_to_quote(&secid, &row)
}

pub async fn history(secid: &str, days: Option<u32>) -> Result<SecurityHistory, String> {
    let secid = valid_secid(secid)?;
    let days = days.unwrap_or(15).clamp(5, 30);
    let http = client()?;
    let url = reqwest::Url::parse_with_params(
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        [
            ("secid", secid.as_str()),
            ("klt", "101"),
            ("fqt", "1"),
            ("lmt", &days.to_string()),
            ("end", "20500101"),
            ("fields1", "f1,f2,f3,f4,f5,f6"),
            ("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"),
        ],
    )
    .map_err(|err| format!("行情地址无效: {err}"))?;
    let body = get_json(&http, url).await?;
    let data = body.get("data").ok_or("没有日线")?;
    let code = text_at(data, "code");
    let name = text_at(data, "name");
    let bars = data
        .get("klines")
        .and_then(Value::as_array)
        .ok_or("没有日线")?
        .iter()
        .filter_map(|item| parse_bar(item.as_str()?))
        .collect::<Vec<_>>();
    if bars.is_empty() {
        return Err("没有日线".into());
    }
    Ok(SecurityHistory {
        secid,
        code,
        name,
        bars,
    })
}

pub async fn account(app: &AppHandle) -> Result<PaperAccount, String> {
    let book = {
        let _guard = paper_lock()?;
        load_book(app)?
    };
    let http = client()?;
    Ok(account_from(&http, &book).await)
}

pub async fn order(
    app: &AppHandle,
    query: Option<&str>,
    secid: Option<&str>,
    side: &str,
    quantity: f64,
) -> Result<PaperOrderResult, String> {
    let buying = match side.trim() {
        "buy" | "买入" => true,
        "sell" | "卖出" => false,
        _ => return Err("side 只能是 buy 或 sell".into()),
    };
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err("数量必须大于 0".into());
    }
    let http = client()?;
    let hit = resolve(&http, query.unwrap_or("").trim(), secid.unwrap_or("").trim()).await?;
    let row = quote_row(&http, &hit.secid).await?;
    let price = num_at(&row, "f2").filter(|price| *price > 0.0).ok_or("没有最新价")?;
    check_lot(&hit, buying, quantity)?;
    let book = apply_fill(app, &hit, buying, quantity, price)?;
    let account = account_from(&http, &book).await;
    Ok(PaperOrderResult {
        side: if buying { "buy" } else { "sell" }.into(),
        code: hit.code,
        name: hit.name,
        kind: hit.kind,
        quantity,
        price,
        account,
    })
}

#[derive(Debug, Clone)]
pub struct LiveInstrument {
    pub symbol: String,
    pub code: String,
    pub name: String,
}

pub async fn prepare_live_order(
    query: &str,
    secid: &str,
    buying: bool,
    quantity: f64,
    price: f64,
) -> Result<LiveInstrument, String> {
    if !price.is_finite() || price <= 0.0 {
        return Err("限价必须大于 0".into());
    }
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err("数量必须大于 0".into());
    }
    if quantity > 1_000_000_000.0 || (quantity - quantity.round()).abs() > 0.001 {
        return Err("实盘数量需要是整数".into());
    }
    let http = client()?;
    let hit = resolve(&http, query.trim(), secid.trim()).await?;
    if hit.secid.starts_with("150.") {
        return Err("场外基金不能从这里下单".into());
    }
    check_lot(&hit, buying, quantity)?;
    Ok(LiveInstrument {
        symbol: exchange_symbol(&hit.secid)?,
        code: hit.code,
        name: hit.name,
    })
}

fn exchange_symbol(secid: &str) -> Result<String, String> {
    let (market, code) = secid.split_once('.').ok_or("代码无效")?;
    if code.len() != 6 || !code.chars().all(|ch| ch.is_ascii_digit()) {
        return Err("代码无效".into());
    }
    if code.starts_with('4') || code.starts_with('8') || code.starts_with("92") {
        return Err("实盘暂不支持北交所".into());
    }
    let suffix = match market {
        "1" => "SH",
        "0" => "SZ",
        _ => return Err("实盘只支持沪深证券".into()),
    };
    Ok(format!("{code}.{suffix}"))
}

async fn resolve(http: &reqwest::Client, query: &str, secid: &str) -> Result<SecurityHit, String> {
    if !secid.is_empty() {
        let secid = valid_secid(secid)?;
        if !query.is_empty() {
            if let Ok(found) = search(query).await {
                if let Some(hit) = found.items.into_iter().find(|item| item.secid == secid) {
                    return Ok(hit);
                }
            }
        }
        let row = quote_row(http, &secid).await?;
        return Ok(SecurityHit {
            code: text_at(&row, "f12"),
            name: text_at(&row, "f14"),
            kind: kind_from_secid(&secid),
            secid,
        });
    }
    if query.is_empty() {
        return Err("请提供名称、代码或 secid".into());
    }
    let found = search(query).await?;
    if found.items.is_empty() {
        return Err(format!("没有找到 {query}"));
    }
    if found.items.len() == 1 {
        return Ok(found.items.into_iter().next().expect("one search hit"));
    }
    if let Some(exact) = found.items.iter().find(|item| item.code == query).cloned() {
        return Ok(exact);
    }
    let lines = found
        .items
        .iter()
        .map(|item| format!("{} {} {} {}", item.code, item.name, item.kind, item.secid))
        .collect::<Vec<_>>()
        .join("\n");
    Err(format!("找到多只，请用 secid 指定一只：\n{lines}"))
}

fn check_lot(hit: &SecurityHit, buying: bool, quantity: f64) -> Result<(), String> {
    if !buying || hit.secid.starts_with("150.") {
        let scaled = (quantity * 100.0).round() / 100.0;
        if (scaled - quantity).abs() > 0.000_001 {
            return Err("基金数量最多保留两位小数".into());
        }
        return Ok(());
    }
    let lot: f64 = if hit.kind.contains('债') { 10.0 } else { 100.0 };
    let steps = quantity / lot;
    if (steps - steps.round()).abs() > 0.001 {
        return Err(format!("买入数量需要是 {lot:.0} 的整数倍"));
    }
    Ok(())
}

fn kind_from_secid(secid: &str) -> String {
    if secid.starts_with("150.") {
        "基金".into()
    } else {
        let code = secid.split('.').nth(1).unwrap_or("");
        if code.starts_with("11") || code.starts_with("12") || code.starts_with("01") {
            "债券".into()
        } else {
            "股票".into()
        }
    }
}

async fn suggest(http: &reqwest::Client, query: &str) -> Result<Vec<SecurityHit>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://searchapi.eastmoney.com/api/suggest/get",
        [
            ("input", query),
            ("type", "14"),
            ("token", SEARCH_TOKEN),
            ("count", "8"),
        ],
    )
    .map_err(|err| format!("搜索地址无效: {err}"))?;
    let body = get_json(http, url).await?;
    let data = body
        .pointer("/QuotationCodeTable/Data")
        .and_then(Value::as_array);
    let Some(data) = data else {
        return Ok(Vec::new());
    };
    Ok(data.iter().filter_map(hit_from_suggest).collect())
}

fn hit_from_suggest(value: &Value) -> Option<SecurityHit> {
    let code = text_at(value, "Code");
    let name = text_at(value, "Name");
    let secid = text_at(value, "QuoteID");
    if code.is_empty() || name.is_empty() || valid_secid(&secid).is_err() {
        return None;
    }
    let kind = text_at(value, "SecurityTypeName");
    Some(SecurityHit {
        code,
        name,
        kind: if kind.is_empty() { kind_from_secid(&secid) } else { kind },
        secid,
    })
}

async fn convertibles(http: &reqwest::Client, query: &str) -> Result<Vec<SecurityHit>, String> {
    let url = reqwest::Url::parse_with_params(
        "https://push2.eastmoney.com/api/qt/clist/get",
        [
            ("pn", "1"),
            ("pz", "400"),
            ("po", "1"),
            ("np", "1"),
            ("fltt", "2"),
            ("invt", "2"),
            ("fid", "f3"),
            ("fs", "b:MK0354"),
            ("fields", "f12,f14"),
        ],
    )
    .map_err(|err| format!("转债地址无效: {err}"))?;
    let body = get_json(http, url).await?;
    let rows = body
        .pointer("/data/diff")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let needle = query.to_lowercase();
    Ok(rows
        .iter()
        .filter_map(|row| {
            let code = text_at(row, "f12");
            let name = text_at(row, "f14");
            if code.is_empty() || name.is_empty() {
                return None;
            }
            let matched = code == query || name.to_lowercase().contains(&needle);
            if !matched {
                return None;
            }
            let market = if code.starts_with("11") { "1" } else { "0" };
            Some(SecurityHit {
                secid: format!("{market}.{code}"),
                code,
                name,
                kind: "可转债".into(),
            })
        })
        .take(8)
        .collect())
}

async fn quote_row(http: &reqwest::Client, secid: &str) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(
        "https://push2.eastmoney.com/api/qt/ulist.np/get",
        [
            ("fltt", "2"),
            ("secids", secid),
            (
                "fields",
                "f2,f3,f4,f5,f6,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21",
            ),
        ],
    )
    .map_err(|err| format!("行情地址无效: {err}"))?;
    let body = get_json(http, url).await?;
    body.pointer("/data/diff/0")
        .cloned()
        .ok_or_else(|| "没有行情".to_string())
}

fn row_to_quote(secid: &str, row: &Value) -> Result<SecurityQuote, String> {
    let price = num_at(row, "f2").ok_or("没有最新价")?;
    Ok(SecurityQuote {
        secid: secid.to_string(),
        code: text_at(row, "f12"),
        name: text_at(row, "f14"),
        price,
        change: num_at(row, "f4").unwrap_or(0.0),
        change_pct: num_at(row, "f3").unwrap_or(0.0),
        open: num_at(row, "f17").unwrap_or(0.0),
        high: num_at(row, "f15").unwrap_or(0.0),
        low: num_at(row, "f16").unwrap_or(0.0),
        prev_close: num_at(row, "f18").unwrap_or(0.0),
        volume: num_at(row, "f5").unwrap_or(0.0),
        amount: num_at(row, "f6").unwrap_or(0.0),
        turnover: num_at(row, "f8"),
        pe: num_at(row, "f9").filter(|value| *value > 0.0),
        market_cap: num_at(row, "f20").filter(|value| *value > 0.0),
    })
}

fn parse_bar(line: &str) -> Option<DailyBar> {
    let parts: Vec<&str> = line.split(',').collect();
    if parts.len() < 9 {
        return None;
    }
    Some(DailyBar {
        date: parts[0].to_string(),
        open: parts[1].parse().ok()?,
        close: parts[2].parse().ok()?,
        high: parts[3].parse().ok()?,
        low: parts[4].parse().ok()?,
        amount: parts[6].parse().unwrap_or(0.0),
        change_pct: parts[8].parse().unwrap_or(0.0),
    })
}

async fn account_from(http: &reqwest::Client, book: &Book) -> PaperAccount {
    let mut positions = Vec::new();
    for position in &book.positions {
        let price = quote_row(http, &position.secid)
            .await
            .ok()
            .and_then(|row| num_at(&row, "f2"));
        positions.push(PaperPosition {
            secid: position.secid.clone(),
            code: position.code.clone(),
            name: position.name.clone(),
            kind: position.kind.clone(),
            quantity: position.quantity,
            cost: position.cost,
            price,
        });
    }
    PaperAccount {
        cash: book.cash,
        positions,
    }
}

fn load_book(app: &AppHandle) -> Result<Book, String> {
    let path = book_path(app)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(Book::default());
    };
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

fn save_book(app: &AppHandle, book: &Book) -> Result<(), String> {
    let path = book_path(app)?;
    let body = serde_json::to_string_pretty(book).map_err(|err| format!("无法保存模拟账户: {err}"))?;
    fs::write(path, body).map_err(|err| format!("无法保存模拟账户: {err}"))
}

fn book_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::config_dir(app)?.join("paper-account.json"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceAlert {
    pub id: String,
    pub secid: String,
    pub code: String,
    pub name: String,
    pub kind: String,
    pub price: Option<f64>,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub note: String,
    pub armed: bool,
    pub triggered_price: Option<f64>,
    #[serde(default)]
    pub side: String,
    #[serde(default)]
    pub quantity: Option<f64>,
    #[serde(default)]
    pub outcome: String,
    #[serde(default)]
    pub outcome_note: String,
}

pub async fn add_alert(
    app: &AppHandle,
    query: Option<&str>,
    secid: Option<&str>,
    kind: &str,
    price: Option<f64>,
    low: Option<f64>,
    high: Option<f64>,
    note: &str,
    side: &str,
    quantity: Option<f64>,
) -> Result<PriceAlert, String> {
    let kind = normalize_kind(kind)?;
    let (price, low, high) = alert_levels(kind, price, low, high)?;
    let side = normalize_side(side)?;
    let http = client()?;
    let hit = resolve(&http, query.unwrap_or("").trim(), secid.unwrap_or("").trim()).await?;
    if !side.is_empty() {
        let quantity = quantity.filter(|value| value.is_finite() && *value > 0.0).ok_or("数量必须大于 0")?;
        check_lot(&hit, side == "buy", quantity)?;
    }
    let note = note.trim().chars().take(80).collect::<String>();
    let _guard = alert_lock()?;
    let mut alerts = load_alerts(app)?;
    if !side.is_empty() {
        if let Some(existing) = alerts.iter().find(|alert| alert.armed && alert.secid == hit.secid && alert.side == side) {
            let same = same_level(existing.quantity, quantity)
                && existing.kind == kind
                && same_level(existing.price, price)
                && same_level(existing.low, low)
                && same_level(existing.high, high);
            if same {
                return Ok(existing.clone());
            }
            return Err("这只已经有一条未完成的条件单".into());
        }
    } else if let Some(existing) = alerts.iter().find(|alert| {
        alert.armed
            && alert.side.is_empty()
            && alert.secid == hit.secid
            && alert.kind == kind
            && same_level(alert.price, price)
            && same_level(alert.low, low)
            && same_level(alert.high, high)
    }) {
        return Ok(existing.clone());
    }
    if alerts.iter().filter(|alert| alert.armed).count() >= 20 {
        return Err("价格提醒太多了，先删掉几条".into());
    }
    let alert = PriceAlert {
        id: next_alert_id(),
        secid: hit.secid,
        code: hit.code,
        name: hit.name,
        kind: kind.to_string(),
        price,
        low,
        high,
        note,
        armed: true,
        triggered_price: None,
        side,
        quantity,
        outcome: String::new(),
        outcome_note: String::new(),
    };
    alerts.push(alert.clone());
    save_alerts(app, &alerts)?;
    Ok(alert)
}

pub fn list_alerts(app: &AppHandle) -> Result<Vec<PriceAlert>, String> {
    let _guard = alert_lock()?;
    load_alerts(app)
}

pub fn remove_alert(app: &AppHandle, id: &str) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("没有这条提醒".into());
    }
    let _guard = alert_lock()?;
    let mut alerts = load_alerts(app)?;
    let before = alerts.len();
    alerts.retain(|alert| alert.id != id);
    if alerts.len() == before {
        return Err("没有这条提醒".into());
    }
    save_alerts(app, &alerts)
}

pub async fn check_alerts(app: &AppHandle) -> Result<Vec<PriceAlert>, String> {
    let armed = {
        let _guard = alert_lock()?;
        load_alerts(app)?.into_iter().filter(|alert| alert.armed).collect::<Vec<_>>()
    };
    if armed.is_empty() {
        return Ok(Vec::new());
    }
    let http = client()?;
    let mut prices = Vec::new();
    for alert in &armed {
        let price = quote_row(&http, &alert.secid)
            .await
            .ok()
            .and_then(|row| num_at(&row, "f2"))
            .filter(|price| *price > 0.0);
        if let Some(price) = price {
            prices.push((alert.id.clone(), price));
        }
    }
    let _guard = alert_lock()?;
    let mut alerts = load_alerts(app)?;
    let mut fired = Vec::new();
    for alert in &mut alerts {
        if !alert.armed {
            continue;
        }
        let Some((_, price)) = prices.iter().find(|(id, _)| id == &alert.id) else {
            continue;
        };
        if crossed(alert, *price) {
            alert.armed = false;
            alert.triggered_price = Some(*price);
            fired.push(alert.clone());
        }
    }
    if !fired.is_empty() {
        save_alerts(app, &alerts)?;
    }
    drop(_guard);
    let mut settled = Vec::new();
    for alert in fired {
        if alert.side != "buy" && alert.side != "sell" {
            settled.push(alert);
            continue;
        }
        let quantity = alert.quantity.unwrap_or(0.0);
        let price = alert.triggered_price.unwrap_or(0.0);
        let hit = SecurityHit {
            code: alert.code.clone(),
            name: alert.name.clone(),
            kind: kind_from_secid(&alert.secid),
            secid: alert.secid.clone(),
        };
        let (outcome, outcome_note) = match apply_fill(app, &hit, alert.side == "buy", quantity, price) {
            Ok(book) => ("filled".to_string(), format!("{:.2}", book.cash)),
            Err(err) => ("failed".to_string(), err),
        };
        let _guard = alert_lock()?;
        let mut alerts = load_alerts(app)?;
        if let Some(slot) = alerts.iter_mut().find(|item| item.id == alert.id) {
            slot.outcome = outcome;
            slot.outcome_note = outcome_note;
            settled.push(slot.clone());
        }
        save_alerts(app, &alerts)?;
    }
    Ok(settled)
}

fn apply_fill(app: &AppHandle, hit: &SecurityHit, buying: bool, quantity: f64, price: f64) -> Result<Book, String> {
    check_lot(hit, buying, quantity)?;
    let _guard = paper_lock()?;
    let mut book = load_book(app)?;
    let notion = price * quantity;
    if buying {
        if book.cash + 0.005 < notion {
            return Err(format!("模拟现金不足：需要 {notion:.2}，可用 {:.2}", book.cash));
        }
        book.cash -= notion;
        if let Some(position) = book.positions.iter_mut().find(|item| item.secid == hit.secid) {
            let next = position.quantity + quantity;
            position.cost = (position.cost * position.quantity + notion) / next;
            position.quantity = next;
            position.name = hit.name.clone();
        } else {
            book.positions.push(StoredPosition {
                secid: hit.secid.clone(),
                code: hit.code.clone(),
                name: hit.name.clone(),
                kind: hit.kind.clone(),
                quantity,
                cost: price,
            });
        }
    } else {
        let held = book
            .positions
            .iter()
            .find(|item| item.secid == hit.secid)
            .map(|item| item.quantity)
            .ok_or_else(|| format!("模拟账户里没有 {}", hit.name))?;
        if held + 0.0001 < quantity {
            return Err(format!("持仓不足：持有 {held:.2}，要卖 {quantity:.2}"));
        }
        book.cash += notion;
        if let Some(position) = book.positions.iter_mut().find(|item| item.secid == hit.secid) {
            position.quantity -= quantity;
        }
        book.positions.retain(|item| item.quantity >= 0.0001);
    }
    save_book(app, &book)?;
    Ok(book)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchItem {
    pub secid: String,
    pub code: String,
    pub name: String,
    pub kind: String,
}

pub async fn add_watch(app: &AppHandle, query: Option<&str>, secid: Option<&str>) -> Result<WatchItem, String> {
    let http = client()?;
    let hit = resolve(&http, query.unwrap_or("").trim(), secid.unwrap_or("").trim()).await?;
    let _guard = watch_lock()?;
    let mut items = load_watch(app)?;
    if let Some(existing) = items.iter().find(|item| item.secid == hit.secid) {
        return Ok(existing.clone());
    }
    if items.len() >= 12 {
        return Err("盯盘太多了，先移出几只".into());
    }
    let item = WatchItem {
        secid: hit.secid,
        code: hit.code,
        name: hit.name,
        kind: hit.kind,
    };
    items.push(item.clone());
    save_watch(app, &items)?;
    Ok(item)
}

pub fn list_watch(app: &AppHandle) -> Result<Vec<WatchItem>, String> {
    let _guard = watch_lock()?;
    load_watch(app)
}

pub fn remove_watch(app: &AppHandle, secid: &str) -> Result<(), String> {
    let secid = secid.trim();
    if secid.is_empty() {
        return Err("盯盘里没有这只".into());
    }
    let _guard = watch_lock()?;
    let mut items = load_watch(app)?;
    let before = items.len();
    items.retain(|item| item.secid != secid);
    if items.len() == before {
        return Err("盯盘里没有这只".into());
    }
    save_watch(app, &items)
}

fn load_watch(app: &AppHandle) -> Result<Vec<WatchItem>, String> {
    let path = watch_path(app)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

fn save_watch(app: &AppHandle, items: &[WatchItem]) -> Result<(), String> {
    let path = watch_path(app)?;
    let body = serde_json::to_string_pretty(items).map_err(|err| format!("无法保存盯盘: {err}"))?;
    fs::write(path, body).map_err(|err| format!("无法保存盯盘: {err}"))
}

fn watch_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::config_dir(app)?.join("watch.json"))
}

fn watch_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().map_err(|_| "盯盘锁损坏".to_string())
}

fn normalize_side(side: &str) -> Result<String, String> {
    match side.trim() {
        "" | "none" | "remind" | "提醒" => Ok(String::new()),
        "buy" | "买入" => Ok("buy".into()),
        "sell" | "卖出" => Ok("sell".into()),
        _ => Err("side 只能是 buy 或 sell".into()),
    }
}

fn alert_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().map_err(|_| "价格提醒锁损坏".to_string())
}

fn normalize_kind(kind: &str) -> Result<&'static str, String> {
    match kind.trim() {
        "below" | "跌破" | "低于" => Ok("below"),
        "above" | "突破" | "高于" => Ok("above"),
        "between" | "区间" | "回踩" => Ok("between"),
        _ => Err("提醒类型只能是 below、above 或 between".into()),
    }
}

fn alert_levels(kind: &str, price: Option<f64>, low: Option<f64>, high: Option<f64>) -> Result<(Option<f64>, Option<f64>, Option<f64>), String> {
    if kind == "between" {
        let low = finite_price(low).ok_or("请给出价格")?;
        let high = finite_price(high).ok_or("请给出价格")?;
        if low >= high {
            return Err("区间下限要小于上限".into());
        }
        return Ok((None, Some(low), Some(high)));
    }
    let price = finite_price(price).ok_or("请给出价格")?;
    Ok((Some(price), None, None))
}

fn finite_price(value: Option<f64>) -> Option<f64> {
    value.filter(|price| price.is_finite() && *price > 0.0)
}

fn same_level(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => (left - right).abs() < 0.0001,
        _ => false,
    }
}

fn crossed(alert: &PriceAlert, price: f64) -> bool {
    match alert.kind.as_str() {
        "below" => alert.price.is_some_and(|target| price <= target),
        "above" => alert.price.is_some_and(|target| price >= target),
        "between" => match (alert.low, alert.high) {
            (Some(low), Some(high)) => price >= low && price <= high,
            _ => false,
        },
        _ => false,
    }
}

fn next_alert_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("a{ms}{n}")
}

fn load_alerts(app: &AppHandle) -> Result<Vec<PriceAlert>, String> {
    let path = alert_path(app)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str(&text).unwrap_or_default())
}

fn save_alerts(app: &AppHandle, alerts: &[PriceAlert]) -> Result<(), String> {
    let path = alert_path(app)?;
    let body = serde_json::to_string_pretty(alerts).map_err(|err| format!("无法保存价格提醒: {err}"))?;
    fs::write(path, body).map_err(|err| format!("无法保存价格提醒: {err}"))
}

fn alert_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(settings::config_dir(app)?.join("price-alerts.json"))
}

async fn get_json(http: &reqwest::Client, url: reqwest::Url) -> Result<Value, String> {
    let response = http
        .get(url)
        .header("Referer", "https://quote.eastmoney.com/")
        .send()
        .await
        .map_err(|err| format!("行情请求失败: {err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("行情读取失败: {err}"))?;
    if !status.is_success() {
        return Err(format!("行情接口返回 {status}"));
    }
    serde_json::from_str(&text).map_err(|_| "行情数据无法解析".to_string())
}

fn valid_secid(secid: &str) -> Result<String, String> {
    let secid = secid.trim();
    let Some((market, code)) = secid.split_once('.') else {
        return Err("secid 无效".into());
    };
    if market.chars().all(|ch| ch.is_ascii_digit())
        && !code.is_empty()
        && code.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        Ok(secid.to_string())
    } else {
        Err("secid 无效".into())
    }
}

fn wants_bonds(query: &str) -> bool {
    query.contains('债') || query.contains('转') || (query.len() >= 6 && query.chars().all(|ch| ch.is_ascii_digit()))
}

fn text_at(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string()
}

fn num_at(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).filter(|item| item.is_finite())
}
