# Forge

用 Tauri 2 做的本地桌面编程 Agent。打开一个项目文件夹后，可以用自然语言让它读代码、改文件、搜索，以及在工作区里运行 PowerShell 命令。

写入和命令默认需要你点一次「允许」。密钥留在本机配置目录，请求从 Rust 发出，不会写进项目。

## 准备

- Node.js 18+
- Rust（stable）
- Windows 上需要已安装的 PowerShell

## 开发

```bash
cd forge
npm install
npm run tauri dev
```

第一次编译 Rust 依赖会比较久。

## 模型

打开右上角「模型」，选择一个 OpenAI 兼容接口：

| 服务商 | 地址 | 说明 |
|---|---|---|
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 默认 `qwen3.8-max`，用百炼 API Key |
| OpenAI | `https://api.openai.com/v1` | 默认 `gpt-6.1-sol` |
| DeepSeek | `https://api.deepseek.com` | 默认 `deepseek-flash` |
| OpenRouter | `https://openrouter.ai/api/v1` | 默认 `anthropic/claude-sonnet-5.5` |
| Ollama | `http://127.0.0.1:11434/v1` | 默认 `qwen3-coder`，可以不填密钥 |

模型名要和供应商提供的一致。

## 权限

- **询问**：改文件、覆盖文件、运行命令前都会停下来等你确认。
- **自动改**：直接改文件，命令仍然要确认。
- **全部允许**：文件和命令都直接执行。顶栏会一直提示。

读文件、列目录和搜索不需要确认，但路径不能离开当前文件夹，也不能读 Forge 自己的配置目录。

## 工具

`read_file`、`edit_file`、`write_file`、`list_dir`、`grep`、`glob`、`run_command`。

`edit_file` 按原文精确替换。对不上、或同一段出现多次时会失败，让模型重新读文件再改。
