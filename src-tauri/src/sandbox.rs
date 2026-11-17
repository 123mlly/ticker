use std::path::{Path, PathBuf};

/// Resolve `user_path` against the workspace root.
/// Existing paths are canonicalized, so symlinks that point outside the
/// workspace are rejected. Missing files are allowed only when every existing
/// ancestor stays inside the root.
pub fn resolve_in_workspace(root: &Path, user_path: &str) -> Result<PathBuf, String> {
    let trimmed = user_path.trim();
    if trimmed.is_empty() {
        return Err("路径不能为空".into());
    }
    if trimmed.contains('\0') {
        return Err("路径无效".into());
    }

    let root = root
        .canonicalize()
        .map_err(|err| format!("工作区不可用: {err}"))?;
    let raw = PathBuf::from(trimmed);
    let joined = if raw.is_absolute() {
        raw
    } else {
        root.join(raw)
    };

    if joined.exists() {
        let canon = joined
            .canonicalize()
            .map_err(|err| format!("无法解析路径: {err}"))?;
        ensure_inside(&root, &canon)?;
        return Ok(canon);
    }

    let mut existing = joined.as_path();
    let mut missing = Vec::new();
    loop {
        if existing.exists() {
            break;
        }
        let name = existing
            .file_name()
            .ok_or_else(|| "路径无效".to_string())?
            .to_os_string();
        missing.push(name);
        existing = existing.parent().ok_or_else(|| "路径无效".to_string())?;
    }

    let canon_existing = existing
        .canonicalize()
        .map_err(|err| format!("无法解析路径: {err}"))?;
    ensure_inside(&root, &canon_existing)?;

    let mut result = canon_existing;
    for name in missing.iter().rev() {
        result.push(name);
    }
    Ok(result)
}

pub fn ensure_inside(root: &Path, path: &Path) -> Result<(), String> {
    let root = if root.exists() {
        root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
    } else {
        root.to_path_buf()
    };
    if path.starts_with(&root) {
        Ok(())
    } else {
        Err("路径超出工作区，已拒绝".into())
    }
}

pub fn deny_protected(path: &Path, protected: &[PathBuf]) -> Result<(), String> {
    for dir in protected {
        let dir = if dir.exists() {
            dir.canonicalize().unwrap_or_else(|_| dir.clone())
        } else {
            dir.clone()
        };
        if path.starts_with(&dir) {
            return Err("不能访问 Ticker 的配置目录".into());
        }
    }
    Ok(())
}

pub fn relative_to(root: &Path, path: &Path) -> String {
    let root_display = strip_verbatim(root);
    let path_display = strip_verbatim(path);
    let relative = path_display
        .strip_prefix(&root_display)
        .unwrap_or(&path_display);
    if relative.as_os_str().is_empty() {
        return ".".into();
    }
    relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    let stripped = text
        .strip_prefix(r"\\?\")
        .unwrap_or(text.as_ref());
    PathBuf::from(stripped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("forge-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn allows_file_inside_workspace() {
        let root = temp_root("inside");
        fs::write(root.join("note.txt"), "hi").unwrap();
        let resolved = resolve_in_workspace(&root, "note.txt").unwrap();
        assert!(resolved.ends_with("note.txt"));
        assert!(resolved.starts_with(root.canonicalize().unwrap()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_parent_escape() {
        let root = temp_root("escape");
        let err = resolve_in_workspace(&root, "../outside.txt").unwrap_err();
        assert!(err.contains("工作区"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_nested_escape() {
        let root = temp_root("nested");
        let err = resolve_in_workspace(&root, "sub/../../outside.txt").unwrap_err();
        assert!(err.contains("工作区"), "{err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn allows_new_file_under_workspace() {
        let root = temp_root("create");
        let resolved = resolve_in_workspace(&root, "src/new.ts").unwrap();
        let canon = root.canonicalize().unwrap();
        assert!(resolved.starts_with(&canon));
        assert!(resolved.ends_with("new.ts"));
        let _ = fs::remove_dir_all(&root);
    }
}
