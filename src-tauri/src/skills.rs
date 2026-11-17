use crate::sandbox;
use crate::settings;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MAX_SKILLS: usize = 40;
const DESCRIPTION_CHARS: usize = 240;
const BODY_CHARS: usize = 20_000;

struct Skill {
    name: String,
    description: String,
    source: String,
    body: String,
    folder: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub name: String,
    pub description: String,
    pub body: String,
    pub origin: String,
    pub folder: String,
}

pub fn skill_index(app: &AppHandle, workspace: Option<&Path>) -> Result<String, String> {
    let skills = discover(app, workspace)?;
    if skills.is_empty() {
        return Ok(String::new());
    }
    let mut lines = String::new();
    for skill in skills.values().take(MAX_SKILLS) {
        if !lines.is_empty() {
            lines.push('\n');
        }
        if skill.description.is_empty() {
            lines.push_str(&format!("- {}", skill.name));
        } else {
            lines.push_str(&format!("- {}: {}", skill.name, skill.description));
        }
    }
    Ok(lines)
}

pub fn read_skill(app: &AppHandle, workspace: Option<&Path>, name: &str) -> Result<String, String> {
    let wanted = name.trim();
    if wanted.is_empty() {
        return Err("技能名不能为空".into());
    }
    let skills = discover(app, workspace)?;
    let Some(skill) = skills.get(wanted) else {
        return Err(format!("没有名为 {wanted} 的技能"));
    };
    let mut text = format!("Skill: {}\nSource: {}\n", skill.name, skill.source);
    if !skill.description.is_empty() {
        text.push_str("Description: ");
        text.push_str(&skill.description);
        text.push('\n');
    }
    text.push('\n');
    text.push_str(if skill.body.trim().is_empty() {
        "This skill has no further instructions."
    } else {
        skill.body.trim()
    });
    Ok(text)
}

fn discover(app: &AppHandle, workspace: Option<&Path>) -> Result<BTreeMap<String, Skill>, String> {
    let (personal, project) = collect_all(app, workspace)?;
    let mut skills = personal;
    for (name, skill) in project {
        skills.insert(name, skill);
    }
    Ok(skills)
}

pub fn list_skills(app: &AppHandle, workspace: Option<&Path>) -> Result<Vec<SkillEntry>, String> {
    let (personal, project) = collect_all(app, workspace)?;
    let mut items = Vec::new();
    for skill in personal.into_values() {
        items.push(SkillEntry {
            name: skill.name,
            description: skill.description,
            body: skill.body,
            origin: "personal".into(),
            folder: skill.folder,
        });
    }
    for skill in project.into_values() {
        items.push(SkillEntry {
            name: skill.name,
            description: skill.description,
            body: String::new(),
            origin: "project".into(),
            folder: skill.folder,
        });
    }
    items.sort_by(|left, right| left.origin.cmp(&right.origin).then(left.name.cmp(&right.name)));
    Ok(items)
}

pub fn save_skill(
    app: &AppHandle,
    name: &str,
    description: &str,
    body: &str,
    previous_folder: Option<&str>,
) -> Result<(), String> {
    let folder = folder_name(name)?;
    let description = squash(description.trim());
    if description.is_empty() {
        return Err("请填写何时使用".into());
    }
    if description.chars().count() > DESCRIPTION_CHARS {
        return Err("何时使用过长".into());
    }
    let body = body.trim();
    if body.is_empty() {
        return Err("请填写做法".into());
    }
    if body.chars().count() > BODY_CHARS {
        return Err("做法过长".into());
    }
    let root = personal_root(app)?;
    let previous = previous_folder.map(str::trim).filter(|value| !value.is_empty());
    let dir = child_dir(&root, &folder)?;
    let replacing_same = previous == Some(folder.as_str());
    if dir.exists() && !replacing_same {
        return Err("已经有这个技能".into());
    }
    write_skill(&dir, &folder, &description, body)?;
    if let Some(old) = previous {
        if old != folder {
            remove_skill_dir(&root, old)?;
        }
    }
    Ok(())
}

pub fn delete_skill(app: &AppHandle, folder: &str) -> Result<(), String> {
    let root = personal_root(app)?;
    let dir = child_dir(&root, folder)?;
    if !dir.join("SKILL.md").is_file() {
        return Err(format!("没有名为 {folder} 的技能"));
    }
    remove_skill_dir(&root, folder)
}

fn collect_all(
    app: &AppHandle,
    workspace: Option<&Path>,
) -> Result<(BTreeMap<String, Skill>, BTreeMap<String, Skill>), String> {
    let mut personal = BTreeMap::new();
    if let Ok(dir) = settings::config_dir(app) {
        collect_dir(&dir.join("skills"), "personal", &mut personal);
    }
    let mut project = BTreeMap::new();
    if let Some(root) = workspace {
        for relative in [".forge/skills", ".agents/skills", ".claude/skills"] {
            let Ok(dir) = sandbox::resolve_in_workspace(root, relative) else {
                continue;
            };
            if dir.is_dir() {
                collect_dir(&dir, relative, &mut project);
            }
        }
    }
    Ok((personal, project))
}

fn personal_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = settings::config_dir(app)?.join("skills");
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建技能目录: {err}"))?;
    dir.canonicalize()
        .map_err(|err| format!("无法解析技能目录: {err}"))
}

fn child_dir(root: &Path, folder: &str) -> Result<PathBuf, String> {
    let folder = folder_name(folder)?;
    let path = root.join(&folder);
    if path.exists() {
        let canon = path
            .canonicalize()
            .map_err(|err| format!("无法解析路径: {err}"))?;
        if canon.parent() != Some(root) {
            return Err("路径超出技能目录，已拒绝".into());
        }
        return Ok(canon);
    }
    if path.parent() != Some(root) {
        return Err("路径超出技能目录，已拒绝".into());
    }
    Ok(path)
}

fn remove_skill_dir(root: &Path, folder: &str) -> Result<(), String> {
    let dir = child_dir(root, folder)?;
    if !dir.is_dir() {
        return Ok(());
    }
    if !dir.join("SKILL.md").is_file() {
        return Err("路径超出技能目录，已拒绝".into());
    }
    fs::remove_dir_all(&dir).map_err(|err| format!("无法删除技能: {err}"))
}

fn write_skill(dir: &Path, name: &str, description: &str, body: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("无法创建技能目录: {err}"))?;
    let text = format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        yaml_quote(name),
        yaml_quote(description),
        body
    );
    fs::write(dir.join("SKILL.md"), text).map_err(|err| format!("无法保存技能: {err}"))
}

fn folder_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("技能名不能为空".into());
    }
    if name.chars().count() > 64 {
        return Err("技能名过长".into());
    }
    if name.chars().any(|ch| ch.is_control()) || name == "." || name == ".." || name.starts_with('.') {
        return Err("技能名无效".into());
    }
    if name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) || name.ends_with([' ', '.']) {
        return Err("技能名不能包含 \\ / : * ? \" < > |".into());
    }
    Ok(name.to_string())
}

fn yaml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn collect_dir(dir: &Path, source_root: &str, skills: &mut BTreeMap<String, Skill>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file = path.join("SKILL.md");
        if !file.is_file() {
            continue;
        }
        if fs::metadata(&file).map(|meta| meta.len() > 256 * 1024).unwrap_or(true) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        let folder = path
            .file_name()
            .and_then(|item| item.to_str())
            .unwrap_or("skill");
        if folder.starts_with('.') {
            continue;
        }
        let (front, body) = split_frontmatter(&text);
        let name = clean_name(&field(&front, "name")).unwrap_or_else(|| clean_name(folder).unwrap_or_else(|| "skill".into()));
        if !skills.contains_key(&name) && skills.len() >= MAX_SKILLS {
            continue;
        }
        let description = clip(&squash(&field(&front, "description")), DESCRIPTION_CHARS);
        let source = format!("{source_root}/{folder}/SKILL.md");
        skills.insert(
            name.clone(),
            Skill {
                name,
                description,
                source,
                body: clip(body.trim(), BODY_CHARS),
                folder: folder.to_string(),
            },
        );
    }
}

fn split_frontmatter(text: &str) -> (String, &str) {
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else {
        return (String::new(), text);
    };
    let rest = rest.strip_prefix('\r').unwrap_or(rest);
    let Some(rest) = rest.strip_prefix('\n') else {
        return (String::new(), text);
    };
    for (index, line) in rest.split_inclusive('\n').enumerate() {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            let offset: usize = rest.split_inclusive('\n').take(index + 1).map(str::len).sum();
            return (rest[..offset.saturating_sub(line.len())].to_string(), &rest[offset..]);
        }
    }
    (String::new(), text)
}

fn field(front: &str, key: &str) -> String {
    let mut lines = front.lines().peekable();
    while let Some(line) = lines.next() {
        let Some(value) = line.strip_prefix(key) else {
            continue;
        };
        let Some(value) = value.strip_prefix(':') else {
            continue;
        };
        let value = value.trim();
        if value == ">" || value == "|" || value == ">-" || value == "|-" {
            let mut folded = String::new();
            while let Some(next) = lines.peek() {
                if next.starts_with(' ') || next.starts_with('\t') {
                    if !folded.is_empty() {
                        folded.push(' ');
                    }
                    folded.push_str(next.trim());
                    lines.next();
                } else {
                    break;
                }
            }
            return folded;
        }
        return unquote(value);
    }
    String::new()
}

fn unquote(value: &str) -> String {
    let value = value.trim();
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"') || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'') {
            return value[1..value.len() - 1].replace("\\n", " ").replace("\\\"", "\"");
        }
    }
    value.to_string()
}

fn clean_name(value: &str) -> Option<String> {
    let name: String = value
        .trim()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(64)
        .collect();
    let name = name.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

fn squash(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
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

#[cfg(test)]
mod tests {
    use super::{field, split_frontmatter};

    #[test]
    fn reads_folded_description() {
        let text = "---\nname: review\ndescription: >-\n  Check a change\n  before shipping.\n---\n\nDo the review.\n";
        let (front, body) = split_frontmatter(text);
        assert_eq!(field(&front, "name"), "review");
        assert_eq!(field(&front, "description"), "Check a change before shipping.");
        assert_eq!(body.trim(), "Do the review.");
    }
}
