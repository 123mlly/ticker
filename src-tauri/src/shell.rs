use crate::sandbox::{deny_protected, resolve_in_workspace};
use encoding_rs::GBK;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub timed_out: bool,
    pub duration_ms: u64,
}

pub async fn run_command(
    root: &Path,
    protected: &[PathBuf],
    command: &str,
    cwd: Option<&str>,
    timeout_sec: Option<u64>,
) -> Result<CommandOutput, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("命令不能为空".into());
    }
    if command.len() > 12_000 {
        return Err("命令过长，已拒绝".into());
    }

    let cwd_path = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(path) => resolve_in_workspace(root, path)?,
        None => root
            .canonicalize()
            .map_err(|err| format!("工作区不可用: {err}"))?,
    };
    deny_protected(&cwd_path, protected)?;
    if !cwd_path.is_dir() {
        return Err("命令工作目录不存在".into());
    }

    let timeout_sec = timeout_sec.unwrap_or(120).clamp(1, 600);
    let script = format!(
        "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; Set-Location -LiteralPath $env:FORGE_CWD; {command}"
    );

    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .current_dir(&cwd_path)
        .env("FORGE_CWD", &cwd_path)
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);

    let mut child = cmd
        .spawn()
        .map_err(|err| format!("无法启动 PowerShell: {err}"))?;
    let stdout = child.stdout.take().ok_or("无法读取命令输出")?;
    let stderr = child.stderr.take().ok_or("无法读取命令错误输出")?;
    let stdout_task = tokio::spawn(read_limited(stdout, 80_000));
    let stderr_task = tokio::spawn(read_limited(stderr, 40_000));

    let started = std::time::Instant::now();
    let waited = timeout(Duration::from_secs(timeout_sec), child.wait()).await;
    let (exit_code, timed_out) = match waited {
        Ok(Ok(status)) => (status.code().unwrap_or(-1), false),
        Ok(Err(err)) => return Err(format!("等待命令失败: {err}")),
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            (-1, true)
        }
    };

    let (stdout_text, stdout_trunc) = stdout_task
        .await
        .unwrap_or_else(|_| (String::new(), true));
    let (stderr_text, stderr_trunc) = stderr_task
        .await
        .unwrap_or_else(|_| (String::new(), true));

    Ok(CommandOutput {
        exit_code,
        stdout: stdout_text,
        stderr: stderr_text,
        truncated: stdout_trunc || stderr_trunc,
        timed_out,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

async fn read_limited<R>(mut reader: R, cap: usize) -> (String, bool)
where
    R: AsyncRead + Unpin,
{
    let mut kept = Vec::new();
    let mut truncated = false;
    let mut drained = 0usize;
    let mut buf = [0u8; 8192];
    loop {
        let read = match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        if kept.len() < cap {
            let room = cap - kept.len();
            let take = read.min(room);
            kept.extend_from_slice(&buf[..take]);
            if take < read {
                truncated = true;
            }
        } else {
            truncated = true;
        }
        if truncated {
            drained += read;
            if drained > 1_000_000 {
                break;
            }
        }
    }
    (decode_output(&kept), truncated)
}

fn decode_output(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (decoded, _, _) = GBK.decode(bytes);
            decoded.into_owned()
        }
    }
}
