use crate::settings::Settings;
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    ToolDelta {
        index: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        arguments: Option<String>,
    },
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallOut {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionResult {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCallOut>,
    pub cancelled: bool,
    pub error: Option<String>,
    pub finish_reason: Option<String>,
}

struct Draft {
    content: String,
    reasoning: String,
    tools: Vec<ToolDraft>,
    finish_reason: String,
}

struct ToolDraft {
    id: String,
    name: String,
    arguments: String,
}

pub async fn complete(
    settings: &Settings,
    messages: Vec<Value>,
    tools: Vec<Value>,
    on_event: Channel<StreamEvent>,
    cancel: Arc<AtomicBool>,
) -> Result<CompletionResult, String> {
    if settings.base_url.trim().is_empty() {
        return Err("还没有配置模型接口".into());
    }
    if settings.model.trim().is_empty() {
        return Err("还没有配置模型名".into());
    }
    if cancel.load(Ordering::Relaxed) {
        return Ok(empty_cancelled());
    }

    let messages = prepare_messages(messages);
    let mut body = json!({
        "model": settings.model,
        "messages": messages,
        "stream": true,
        "temperature": 0.2,
        "max_tokens": 8192,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = json!("auto");
    }
    if settings.base_url.contains("dashscope") {
        body["enable_thinking"] = json!(false);
    }
    if settings.base_url.contains("moonshot") {
        if let Some(map) = body.as_object_mut() {
            map.remove("temperature");
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|err| format!("无法创建 HTTP 客户端: {err}"))?;

    let first = post_chat(&client, settings, body.clone()).await?;
    let response = if first.status().as_u16() == 400 {
        let text = first.text().await.unwrap_or_default();
        let lower = text.to_lowercase();
        let mut changed = false;
        if let Some(map) = body.as_object_mut() {
            if lower.contains("temperature") {
                map.remove("temperature");
                changed = true;
            }
            if lower.contains("max_tokens") || lower.contains("max_completion_tokens") {
                map.remove("max_tokens");
                changed = true;
            }
        }
        if changed {
            post_chat(&client, settings, body).await?
        } else {
            return Err(format!("模型接口返回 400: {}", clip(&text, 600)));
        }
    } else {
        first
    };

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!(
            "模型接口返回 {}: {}",
            status.as_u16(),
            clip(&text, 600)
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();

    if content_type.contains("application/json") {
        return read_json(response, &on_event).await;
    }
    read_sse(response, &on_event, &cancel).await
}

pub async fn test_connection(settings: &Settings) -> Result<String, String> {
    if settings.base_url.trim().is_empty() {
        return Err("接口地址不能为空".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| err.to_string())?;
    let url = format!("{}/models", settings.base_url.trim_end_matches('/'));
    let mut request = client.get(&url);
    if !settings.api_key.trim().is_empty() {
        request = request.bearer_auth(settings.api_key.trim());
    }
    let response = request
        .send()
        .await
        .map_err(|err| format!("无法连接: {err}"))?;
    let status = response.status();
    if status.as_u16() == 404 {
        return Ok("地址可达，但没有 /models。可以直接开始对话。".into());
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err("密钥被拒绝".into());
    }
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("探测失败 {}: {}", status.as_u16(), clip(&text, 300)));
    }
    let body: Value = response.json().await.unwrap_or(Value::Null);
    let count = body["data"].as_array().map(|items| items.len());
    match count {
        Some(count) => Ok(format!("已连通，发现 {count} 个模型")),
        None => Ok("已连通".into()),
    }
}

async fn post_chat(
    client: &reqwest::Client,
    settings: &Settings,
    body: Value,
) -> Result<reqwest::Response, String> {
    let url = format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    );
    let mut request = client
        .post(url)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::USER_AGENT, "Ticker/0.1")
        .json(&body);
    if !settings.api_key.trim().is_empty() {
        request = request.bearer_auth(settings.api_key.trim());
    }
    if settings.base_url.contains("openrouter.ai") {
        request = request
            .header("HTTP-Referer", "https://forge.local")
            .header("X-Title", "Ticker");
    }
    request
        .send()
        .await
        .map_err(|err| format!("无法连接模型接口: {err}"))
}

async fn read_json(
    response: reqwest::Response,
    on_event: &Channel<StreamEvent>,
) -> Result<CompletionResult, String> {
    let value: Value = response
        .json()
        .await
        .map_err(|err| format!("无法解析模型响应: {err}"))?;
    if let Some(error) = value.get("error") {
        return Err(format!("模型错误: {}", clip(&error.to_string(), 600)));
    }
    let choice = &value["choices"][0];
    let message = &choice["message"];
    let mut content = String::new();
    append_text(&mut content, &message["content"]);
    let mut reasoning = String::new();
    append_text(&mut reasoning, &message["reasoning_content"]);
    if reasoning.is_empty() {
        append_text(&mut reasoning, &message["reasoning"]);
    }
    let finish_reason = choice["finish_reason"].as_str().filter(|reason| !reason.is_empty()).map(str::to_string);
    if !content.is_empty() {
        let _ = on_event.send(StreamEvent::Text {
            text: content.clone(),
        });
    }
    if !reasoning.is_empty() {
        let _ = on_event.send(StreamEvent::Reasoning {
            text: reasoning.clone(),
        });
    }
    let tool_calls = tool_calls_from_message(message);
    for (index, call) in tool_calls.iter().enumerate() {
        let _ = on_event.send(StreamEvent::ToolDelta {
            index: index as u32,
            id: Some(call.id.clone()),
            name: Some(call.name.clone()),
            arguments: Some(call.arguments.clone()),
        });
    }
    let _ = on_event.send(StreamEvent::Done);
    Ok(CompletionResult {
        content,
        reasoning,
        tool_calls,
        cancelled: false,
        error: None,
        finish_reason,
    })
}

async fn read_sse(
    response: reqwest::Response,
    on_event: &Channel<StreamEvent>,
    cancel: &AtomicBool,
) -> Result<CompletionResult, String> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut draft = Draft {
        content: String::new(),
        reasoning: String::new(),
        tools: Vec::new(),
        finish_reason: String::new(),
    };
    let mut cancelled = false;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let bytes = match chunk {
            Ok(bytes) => bytes,
            Err(err) => {
                return Ok(finish(
                    draft,
                    cancelled,
                    Some(format!("流式响应中断: {err}")),
                    on_event,
                ));
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buffer.find('\n') {
            let line = buffer.drain(..=pos).collect::<String>();
            if let Err(message) = handle_line(line.trim_end_matches(['\r', '\n']), &mut draft, on_event)
            {
                return Ok(finish(draft, cancelled, Some(message), on_event));
            }
        }
    }
    if !buffer.trim().is_empty() {
        let _ = handle_line(buffer.trim(), &mut draft, on_event);
    }
    Ok(finish(draft, cancelled, None, on_event))
}

fn handle_line(line: &str, draft: &mut Draft, on_event: &Channel<StreamEvent>) -> Result<(), String> {
    let Some(data) = line.trim().strip_prefix("data:") else {
        return Ok(());
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return Ok(());
    }
    let value: Value = match serde_json::from_str(data) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    if let Some(error) = value.get("error") {
        if !error.is_null() {
            return Err(format!("模型错误: {}", clip(&error.to_string(), 600)));
        }
    }
    let choice = &value["choices"][0];
    if choice.is_null() {
        return Ok(());
    }
    let delta = if choice.get("delta").is_some() {
        &choice["delta"]
    } else {
        &choice["message"]
    };
    let content_at = draft.content.len();
    append_text(&mut draft.content, &delta["content"]);
    if draft.content.len() > content_at {
        let _ = on_event.send(StreamEvent::Text {
            text: draft.content[content_at..].to_string(),
        });
    }
    let reasoning_at = draft.reasoning.len();
    append_text(&mut draft.reasoning, &delta["reasoning_content"]);
    if draft.reasoning.len() == reasoning_at {
        append_text(&mut draft.reasoning, &delta["reasoning"]);
    }
    if draft.reasoning.len() > reasoning_at {
        let _ = on_event.send(StreamEvent::Reasoning {
            text: draft.reasoning[reasoning_at..].to_string(),
        });
    }
    if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
        if !reason.is_empty() {
            draft.finish_reason = reason.to_string();
        }
    }
    if let Some(calls) = delta["tool_calls"].as_array() {
        for call in calls {
            let index = call["index"].as_u64().unwrap_or(0) as usize;
            while draft.tools.len() <= index {
                draft.tools.push(ToolDraft {
                    id: String::new(),
                    name: String::new(),
                    arguments: String::new(),
                });
            }
            let slot = &mut draft.tools[index];
            let id = call["id"].as_str().map(str::to_string);
            let name = call["function"]["name"].as_str().map(str::to_string);
            let arguments = call["function"]["arguments"].as_str().map(str::to_string);
            if let Some(id) = &id {
                if !id.is_empty() {
                    slot.id = id.clone();
                }
            }
            if let Some(name) = &name {
                slot.name.push_str(name);
            }
            if let Some(arguments) = &arguments {
                slot.arguments.push_str(arguments);
            }
            let _ = on_event.send(StreamEvent::ToolDelta {
                index: index as u32,
                id,
                name,
                arguments,
            });
        }
    }
    Ok(())
}

fn finish(
    draft: Draft,
    cancelled: bool,
    error: Option<String>,
    on_event: &Channel<StreamEvent>,
) -> CompletionResult {
    let _ = on_event.send(StreamEvent::Done);
    let tool_calls = draft
        .tools
        .into_iter()
        .enumerate()
        .filter_map(|(index, tool)| {
            if tool.name.is_empty() {
                return None;
            }
            let id = if tool.id.is_empty() {
                format!("call_{index}")
            } else {
                tool.id
            };
            let arguments = if tool.arguments.trim().is_empty() {
                "{}".into()
            } else {
                tool.arguments
            };
            Some(ToolCallOut {
                id,
                name: tool.name,
                arguments,
            })
        })
        .collect();
    CompletionResult {
        content: draft.content,
        reasoning: draft.reasoning,
        tool_calls,
        cancelled,
        error,
        finish_reason: if draft.finish_reason.is_empty() {
            None
        } else {
            Some(draft.finish_reason)
        },
    }
}

fn append_text(target: &mut String, value: &Value) {
    match value {
        Value::String(text) => target.push_str(text),
        Value::Array(items) => {
            for item in items {
                if let Some(text) = item.as_str() {
                    target.push_str(text);
                } else if let Some(text) = item.get("text").and_then(Value::as_str) {
                    target.push_str(text);
                } else if let Some(text) = item.get("content").and_then(Value::as_str) {
                    target.push_str(text);
                }
            }
        }
        Value::Object(_) => {
            if let Some(text) = value.get("text").and_then(Value::as_str) {
                target.push_str(text);
            }
        }
        _ => {}
    }
}

fn tool_calls_from_message(message: &Value) -> Vec<ToolCallOut> {
    let Some(calls) = message["tool_calls"].as_array() else {
        return Vec::new();
    };
    calls
        .iter()
        .enumerate()
        .filter_map(|(index, call)| {
            let name = call["function"]["name"].as_str().unwrap_or("").to_string();
            if name.is_empty() {
                return None;
            }
            let id = call["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("call_{index}"));
            let arguments = match &call["function"]["arguments"] {
                Value::String(text) if !text.trim().is_empty() => text.clone(),
                Value::String(_) | Value::Null => "{}".into(),
                other => other.to_string(),
            };
            Some(ToolCallOut {
                id,
                name,
                arguments,
            })
        })
        .collect()
}

fn prepare_messages(mut messages: Vec<Value>) -> Vec<Value> {
    for message in &mut messages {
        if !message.is_object() {
            continue;
        }
        let role = message
            .get("role")
            .and_then(|role| role.as_str())
            .unwrap_or("")
            .to_string();
        if role == "assistant" {
            let empty = message
                .get("content")
                .map(|content| content.is_null() || content.as_str() == Some(""))
                .unwrap_or(true);
            let has_tools = message
                .get("tool_calls")
                .and_then(|tools| tools.as_array())
                .map(|tools| !tools.is_empty())
                .unwrap_or(false);
            if empty && has_tools {
                message["content"] = Value::Null;
            }
        }
        if role == "tool" && !message.get("content").is_some_and(|content| content.is_string()) {
            message["content"] = Value::String(String::new());
        }
    }
    messages
}

fn empty_cancelled() -> CompletionResult {
    CompletionResult {
        content: String::new(),
        reasoning: String::new(),
        tool_calls: Vec::new(),
        cancelled: true,
        error: None,
        finish_reason: None,
    }
}

fn clip(text: &str, max: usize) -> String {
    let compact = text.replace('\n', " ");
    if compact.chars().count() <= max {
        compact
    } else {
        let mut clipped: String = compact.chars().take(max).collect();
        clipped.push('…');
        clipped
    }
}
