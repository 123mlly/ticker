use crate::sandbox;
use crate::settings;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const INDEX_LINES: usize = 200;
const INDEX_CHARS: usize = 25_000;
const NOTE_CHARS: usize = 30_000;
const MEMORY_CHARS: usize = 80_000;
const NOTE_LIMIT: usize = 2_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNote {
    pub path: String,
    pub content: String,
}

pub fn project_instructions(root: &Path) -> Result<Option<ProjectNote>, String> {
    const CANDIDATES: [&str; 3] = ["CLAUDE.md", ".claude/CLAUDE.md", "AGENTS.md"];
    for relative in CANDIDATES {
        let path = match sandbox::resolve_in_workspace(root, relative) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if !path.is_file() {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|err| format!("无法读取 {relative}: {err}"))?;
        return Ok(Some(ProjectNote {
            path: relative.replace('\\', "/"),
            content: clip(&text, NOTE_CHARS),
        }));
    }
    Ok(None)
}

pub fn memory_index(app: &AppHandle, workspace: Option<&str>) -> Result<String, String> {
    let path = memory_file(app, workspace)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(String::new());
    };
    Ok(head(&text))
}

pub fn read_memory(app: &AppHandle, workspace: Option<&str>) -> Result<String, String> {
    let path = memory_file(app, workspace)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok("还没有笔记。".into());
    };
    if text.trim().is_empty() {
        return Ok("还没有笔记。".into());
    }
    Ok(clip(&text, MEMORY_CHARS))
}

pub fn remember(app: &AppHandle, workspace: Option<&str>, note: &str) -> Result<String, String> {
    let note = note.trim();
    if note.is_empty() {
        return Err("笔记是空的".into());
    }
    let note = clip(note, NOTE_LIMIT);
    let path = memory_file(app, workspace)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建笔记目录: {err}"))?;
    }
    let mut current = fs::read_to_string(&path).unwrap_or_default();
    let heading = format!("## {}", today());
    if !current.contains(&heading) {
        if !current.is_empty() && !current.ends_with('\n') {
            current.push('\n');
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(&heading);
        current.push('\n');
    } else if !current.ends_with('\n') {
        current.push('\n');
    }
    current.push_str("- ");
    current.push_str(&note.replace('\n', " "));
    current.push('\n');
    fs::write(&path, current).map_err(|err| format!("无法保存笔记: {err}"))?;
    Ok("已记下。".into())
}

fn memory_file(app: &AppHandle, workspace: Option<&str>) -> Result<PathBuf, String> {
    Ok(settings::config_dir(app)?
        .join("memory")
        .join(scope_key(workspace))
        .join("MEMORY.md"))
}

fn scope_key(workspace: Option<&str>) -> String {
    let Some(path) = workspace.map(str::trim).filter(|item| !item.is_empty()) else {
        return "global".into();
    };
    let name = Path::new(path)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or("repo");
    let safe: String = name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let mut hash: u64 = 14_695_981_039_346_656_037;
    for byte in path.to_lowercase().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(1_099_511_628_211);
    }
    format!("{safe}-{hash:x}")
}

fn head(text: &str) -> String {
    let mut lines = String::new();
    let mut count = 0;
    for line in text.lines() {
        if count >= INDEX_LINES || lines.len() >= INDEX_CHARS {
            break;
        }
        if count > 0 {
            lines.push('\n');
        }
        lines.push_str(line);
        count += 1;
    }
    lines
}

fn clip(text: &str, max: usize) -> String {
    let mut end = text.len().min(max);
    while !text.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    if end < text.len() {
        format!("{}\n…[已截断]", &text[..end])
    } else {
        text.to_string()
    }
}

fn today() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let z = days + 719_468;
    let era = z / 1_461_097;
    let doe = z - era * 1_461_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}")
}
