use crate::sandbox::{deny_protected, relative_to, resolve_in_workspace};
use globset::{GlobBuilder, GlobSetBuilder};
use regex::Regex;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".nuxt",
    "coverage",
    ".idea",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub path: String,
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub total_lines: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub path: String,
    pub bytes: usize,
    pub created: bool,
    pub previous: Option<String>,
    pub previous_omitted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditFileResult {
    pub path: String,
    pub replacements: usize,
    pub previous: Option<String>,
    pub previous_omitted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub matches: Vec<GrepHit>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobResult {
    pub files: Vec<String>,
    pub truncated: bool,
}

pub fn read_picked(protected: &[PathBuf], path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    let raw = PathBuf::from(trimmed);
    if !raw.is_file() {
        return Err("不是文件".into());
    }
    let full = raw
        .canonicalize()
        .map_err(|err| format!("无法读取文件: {err}"))?;
    deny_protected(&full, protected)?;
    ensure_text(&full)?;
    let len = fs::metadata(&full)
        .map_err(|err| format!("无法读取文件: {err}"))?
        .len();
    if len > 512 * 1024 {
        return Err("文件超过 512 KB，已跳过".into());
    }
    let text = fs::read_to_string(&full).map_err(|err| format!("无法读取文件: {err}"))?;
    Ok(clip_chars(&text, 12_000))
}

fn clip_chars(text: &str, max: usize) -> String {
    let count = text.chars().count();
    if count <= max {
        return text.to_string();
    }
    let clipped: String = text.chars().take(max).collect();
    format!("{clipped}\n…[已截断]")
}

pub fn read_file(
    root: &Path,
    protected: &[PathBuf],
    path: &str,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<ReadFileResult, String> {
    let full = resolve_in_workspace(root, path)?;
    deny_protected(&full, protected)?;
    if !full.is_file() {
        return Err("不是文件".into());
    }
    ensure_text(&full)?;

    let start = offset.unwrap_or(1).max(1);
    let limit = limit.unwrap_or(200).clamp(1, 400);
    let end = start.saturating_add(limit).saturating_sub(1);

    let file = File::open(&full).map_err(|err| format!("无法读取文件: {err}"))?;
    let reader = BufReader::new(file);
    let mut collected = Vec::new();
    let mut total = 0usize;

    for (index, line) in reader.split(b'\n').enumerate() {
        let line = line.map_err(|err| format!("无法读取文件: {err}"))?;
        total = index + 1;
        if total > 200_000 {
            return Err("文件行数过多".into());
        }
        if total >= start && total <= end {
            let mut text = String::from_utf8_lossy(&line).into_owned();
            if text.ends_with('\r') {
                text.pop();
            }
            collected.push(text);
        }
    }

    let end_line = if collected.is_empty() {
        start.saturating_sub(1)
    } else {
        start + collected.len() - 1
    };

    Ok(ReadFileResult {
        path: relative_to(root, &full),
        content: collected.join("\n"),
        start_line: start,
        end_line,
        total_lines: total,
        truncated: end_line < total,
    })
}

pub fn write_file(
    root: &Path,
    protected: &[PathBuf],
    path: &str,
    content: &str,
) -> Result<WriteFileResult, String> {
    if content.len() > 1_500_000 {
        return Err("内容超过 1.5 MB，已拒绝".into());
    }
    let full = resolve_in_workspace(root, path)?;
    deny_protected(&full, protected)?;
    let created = !full.exists();
    let (previous, previous_omitted) = if created {
        (None, false)
    } else {
        snapshot_text(&full)
    };
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("无法创建目录: {err}"))?;
    }
    fs::write(&full, content).map_err(|err| format!("无法写入文件: {err}"))?;
    Ok(WriteFileResult {
        path: relative_to(root, &full),
        bytes: content.len(),
        created,
        previous,
        previous_omitted,
    })
}

pub fn delete_file(root: &Path, protected: &[PathBuf], path: &str) -> Result<(), String> {
    let full = resolve_in_workspace(root, path)?;
    deny_protected(&full, protected)?;
    if !full.is_file() {
        return Err("不是文件".into());
    }
    fs::remove_file(&full).map_err(|err| format!("无法删除文件: {err}"))?;
    Ok(())
}

pub fn edit_file(
    root: &Path,
    protected: &[PathBuf],
    path: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Result<EditFileResult, String> {
    let full = resolve_in_workspace(root, path)?;
    deny_protected(&full, protected)?;
    if !full.is_file() {
        return Err("不是文件".into());
    }
    ensure_text(&full)?;
    let original = fs::read_to_string(&full).map_err(|err| format!("无法读取文件: {err}"))?;
    let (previous, previous_omitted) = if original.len() <= 80_000 {
        (Some(original.clone()), false)
    } else {
        (None, true)
    };
    let (updated, replacements) = apply_edit(&original, old, new, replace_all)?;
    fs::write(&full, updated).map_err(|err| format!("无法写入文件: {err}"))?;
    Ok(EditFileResult {
        path: relative_to(root, &full),
        replacements,
        previous,
        previous_omitted,
    })
}

pub fn list_dir(root: &Path, protected: &[PathBuf], path: &str) -> Result<Vec<DirEntry>, String> {
    let query = if path.trim().is_empty() { "." } else { path };
    let full = resolve_in_workspace(root, query)?;
    deny_protected(&full, protected)?;
    if !full.is_dir() {
        return Err("不是目录".into());
    }

    let mut entries = Vec::new();
    let read = fs::read_dir(&full).map_err(|err| format!("无法列出目录: {err}"))?;
    for item in read {
        let item = item.map_err(|err| format!("无法列出目录: {err}"))?;
        let file_type = item.file_type().map_err(|err| format!("无法列出目录: {err}"))?;
        let meta_size = item.metadata().map(|meta| meta.len()).unwrap_or(0);
        let name = item.file_name().to_string_lossy().to_string();
        let child = item.path();
        entries.push(DirEntry {
            name,
            path: relative_to(root, &child),
            is_dir: file_type.is_dir(),
            size: if file_type.is_dir() { 0 } else { meta_size },
        });
        if entries.len() >= 500 {
            break;
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn grep(
    root: &Path,
    protected: &[PathBuf],
    pattern: &str,
    path: &str,
    glob: Option<&str>,
) -> Result<GrepResult, String> {
    if pattern.trim().is_empty() {
        return Err("搜索表达式不能为空".into());
    }
    if pattern.len() > 500 {
        return Err("搜索表达式过长".into());
    }
    let regex = Regex::new(pattern).map_err(|err| format!("无效的正则: {err}"))?;
    let query = if path.trim().is_empty() { "." } else { path };
    let start = resolve_in_workspace(root, query)?;
    deny_protected(&start, protected)?;

    let matcher = glob
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(build_glob)
        .transpose()?;

    let mut matches = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;

    if start.is_file() {
        collect_grep(root, &start, &regex, &mut matches, &mut truncated);
    } else {
        let walker = WalkDir::new(&start).follow_links(false).into_iter();
        for item in walker.filter_entry(|entry| !skip_dir(entry)) {
            let item = match item {
                Ok(item) => item,
                Err(_) => continue,
            };
            if !item.file_type().is_file() {
                continue;
            }
            visited += 1;
            if visited > 20_000 {
                truncated = true;
                break;
            }
            let rel = relative_to(root, item.path());
            if let Some(matcher) = &matcher {
                if !matcher.is_match(&rel) {
                    continue;
                }
            }
            if matches.len() >= 150 {
                truncated = true;
                break;
            }
            collect_grep(root, item.path(), &regex, &mut matches, &mut truncated);
            if matches.len() >= 150 {
                truncated = true;
                break;
            }
        }
    }

    Ok(GrepResult { matches, truncated })
}

pub fn glob_files(root: &Path, protected: &[PathBuf], pattern: &str) -> Result<GlobResult, String> {
    if pattern.trim().is_empty() {
        return Err("glob 不能为空".into());
    }
    let matcher = build_glob(pattern)?;
    deny_protected(root, protected)?;

    let mut files = Vec::new();
    let mut truncated = false;
    let mut visited = 0usize;
    let walker = WalkDir::new(root).follow_links(false).into_iter();
    for item in walker.filter_entry(|entry| !skip_dir(entry)) {
        let item = match item {
            Ok(item) => item,
            Err(_) => continue,
        };
        if !item.file_type().is_file() {
            continue;
        }
        visited += 1;
        if visited > 20_000 || files.len() >= 200 {
            truncated = true;
            break;
        }
        let rel = relative_to(root, item.path());
        if matcher.is_match(&rel) || matcher.is_match(file_name(item.path())) {
            files.push(rel);
        }
    }
    files.sort();
    Ok(GlobResult { files, truncated })
}

fn collect_grep(
    root: &Path,
    path: &Path,
    regex: &Regex,
    matches: &mut Vec<GrepHit>,
    truncated: &mut bool,
) {
    if matches.len() >= 150 {
        *truncated = true;
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() > 1_000_000 || !is_probably_text(path) {
        return;
    }
    let Ok(file) = File::open(path) else {
        return;
    };
    let reader = BufReader::new(file);
    for (index, line) in reader.split(b'\n').enumerate() {
        if matches.len() >= 150 {
            *truncated = true;
            return;
        }
        let Ok(line) = line else {
            return;
        };
        if line.contains(&0) {
            return;
        }
        let text = String::from_utf8_lossy(&line);
        let text = text.trim_end_matches('\r');
        if regex.is_match(text) {
            let mut clipped = text.to_string();
            if clipped.chars().count() > 300 {
                clipped = clipped.chars().take(300).collect::<String>() + "…";
            }
            matches.push(GrepHit {
                path: relative_to(root, path),
                line: index + 1,
                text: clipped,
            });
        }
    }
}

fn build_glob(pattern: &str) -> Result<globset::GlobSet, String> {
    let mut pat = pattern.trim().replace('\\', "/");
    if !pat.contains('/') {
        pat = format!("**/{pat}");
    }
    let glob = GlobBuilder::new(&pat)
        .case_insensitive(true)
        .literal_separator(false)
        .build()
        .map_err(|err| format!("无效的 glob: {err}"))?;
    GlobSetBuilder::new()
        .add(glob)
        .build()
        .map_err(|err| format!("无效的 glob: {err}"))
}

fn skip_dir(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    SKIP_DIRS.iter().any(|skip| *skip == name)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn snapshot_text(path: &Path) -> (Option<String>, bool) {
    if !path.is_file() || !is_probably_text(path) {
        return (None, true);
    }
    match fs::read_to_string(path) {
        Ok(text) if text.len() <= 80_000 => (Some(text), false),
        _ => (None, true),
    }
}

fn ensure_text(path: &Path) -> Result<(), String> {
    if is_probably_text(path) {
        Ok(())
    } else {
        Err("这是二进制文件，已跳过".into())
    }
}

fn is_probably_text(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let mut reader = BufReader::new(file);
    let mut buffer = [0u8; 8000];
    let Ok(n) = std::io::Read::read(&mut reader, &mut buffer) else {
        return false;
    };
    !buffer[..n].contains(&0)
}

fn apply_edit(original: &str, old: &str, new: &str, replace_all: bool) -> Result<(String, usize), String> {
    if old.is_empty() {
        return Err("old_string 不能为空".into());
    }
    if old == new {
        return Err("新旧内容相同，未修改".into());
    }
    let count = original.matches(old).count();
    if count == 0 {
        return Err("找不到要替换的原文。请先 read_file，并让 old_string 与文件内容完全一致".into());
    }
    if count > 1 && !replace_all {
        return Err(format!("原文出现了 {count} 次。请扩大上下文，或设置 replace_all"));
    }
    let updated = if replace_all {
        original.replace(old, new)
    } else {
        original.replacen(old, new, 1)
    };
    let replacements = if replace_all { count } else { 1 };
    Ok((updated, replacements))
}

#[cfg(test)]
mod tests {
    use super::apply_edit;

    #[test]
    fn replaces_unique_text() {
        let (next, n) = apply_edit("alpha beta", "beta", "gamma", false).unwrap();
        assert_eq!(next, "alpha gamma");
        assert_eq!(n, 1);
    }

    #[test]
    fn rejects_ambiguous_text() {
        let err = apply_edit("a a", "a", "b", false).unwrap_err();
        assert!(err.contains("2"));
    }

    #[test]
    fn replaces_all_when_asked() {
        let (next, n) = apply_edit("a a", "a", "b", true).unwrap();
        assert_eq!(next, "b b");
        assert_eq!(n, 2);
    }

    #[test]
    fn rejects_missing_text() {
        assert!(apply_edit("alpha", "nope", "x", false).is_err());
    }
}
