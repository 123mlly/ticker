import {
  completeChat,
  editFile,
  globWorkspace,
  grepWorkspace,
  listDir,
  memoryIndex,
  addPriceAlert,
  brokerAccount,
  brokerOrder,
  brokerStatus,
  listPriceAlerts,
  addWatch,
  listWatch,
  removeWatch,
  paperAccount,
  paperOrder,
  removePriceAlert,
  projectInstructions,
  quoteSecurity,
  readFile,
  readMemoryNote,
  readSkill,
  rememberNote,
  skillIndex,
  runCommand,
  searchSecurities,
  securityHistory,
  writeFile,
} from "./api";
import { getLocale, localizeBackend, t } from "./i18n";
import { uid } from "./session";
import type {
  PriceAlert,
  ApiContent,
  ApiMessage,
  ApprovalRequest,
  ChatMessage,
  FileChange,
  CommandOutput,
  DirEntry,
  GlobResult,
  GrepResult,
  BrokerAccount,
  BrokerOrderResult,
  BrokerStatus,
  PaperAccount,
  PaperOrderResult,
  PermissionMode,
  ReadFileResult,
  SecurityHistory,
  SecurityQuote,
  SecuritySearch,
  StreamEvent,
  ToolCall,
} from "./types";

const MARKET_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_securities",
      description:
        "Search A-shares, funds, and bonds by name or code. Returns secid values used by the quote and history tools.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or code, such as 贵州茅台, 005827, or 转债." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quote_security",
      description: "Latest price for one security. secid comes from search_securities, for example 1.600519.",
      parameters: {
        type: "object",
        properties: {
          secid: { type: "string" },
        },
        required: ["secid"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "security_history",
      description: "Recent daily bars for one security. Use this before giving a market view.",
      parameters: {
        type: "object",
        properties: {
          secid: { type: "string" },
          days: { type: "integer", description: "Number of daily bars, 5-30. Defaults to 15." },
        },
        required: ["secid"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paper_account",
      description:
        "Read the local simulated portfolio. It starts with 100000 CNY cash and is not a brokerage account.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "paper_order",
      description:
        "Buy or sell in the local simulated portfolio at the latest price. Nothing is sent to a broker. Call only when the user explicitly asks to buy or sell. Stock buys must be multiples of 100 shares. Bond buys must be multiples of 10. OTC fund quantity is shares and may have two decimals.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or code. Omit if secid is set." },
          secid: { type: "string", description: "Use this when search returned more than one match." },
          side: { type: "string", description: "buy or sell" },
          quantity: { type: "number" },
        },
        required: ["side", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "price_alert",
      description:
        "Save, list, or remove a local price reminder. kind below means the latest price is at or under price. kind above means at or over price. kind between means the price is inside low and high. Omit side for a reminder that does not trade. Set side and quantity only when the user explicitly asks the simulated account to buy or sell at that price. That order is confirmed once, then fills at the latest price while Ticker is open. It never reaches a broker. Do not use it for a real-account decision. Use list to show reminders. Use remove with id.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "add, list, or remove" },
          query: { type: "string", description: "Name or code for add. Omit if secid is set." },
          secid: { type: "string" },
          kind: { type: "string", description: "below, above, or between" },
          price: { type: "number", description: "Target for below or above." },
          low: { type: "number", description: "Lower bound for between." },
          high: { type: "number", description: "Upper bound for between." },
          note: { type: "string", description: "Short reason, such as 考虑减仓." },
          side: { type: "string", description: "buy or sell. Omit for a reminder that does not trade." },
          quantity: { type: "number", description: "Simulated quantity. Required when side is set. Stock buys are multiples of 100." },
          id: { type: "string", description: "Alert id for remove." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "watch_security",
      description:
        "Add, list, or remove a security on the local watchlist. Prices refresh in the market view while Ticker is open. This does not place an order and is not a price alert. Use add when the user asks to watch, 盯盘, or keep an eye on a name or code. Use remove with secid. Use list to read the watchlist.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "add, list, or remove" },
          query: { type: "string", description: "Name or code for add. Omit if secid is set." },
          secid: { type: "string", description: "Security id. Required for remove." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "broker_status",
      description:
        "Check whether a real brokerage session is connected on this computer. Call this before a 实盘 decision. It does not place an order.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "broker_account",
      description:
        "Read cash and positions from the connected brokerage account. Call this before choosing a live quantity. It is not the paper account.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "broker_order",
      description:
        "Send a limit order to the connected broker. Call it only after the user explicitly says to send the order. The app asks for confirmation. price is the limit. Stock buys are multiples of 100. Bond buys are multiples of 10. Never use this for the paper account, and never use paper_order for 实盘.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name or code. Omit if secid is set." },
          secid: { type: "string", description: "Use this when search returned more than one match." },
          side: { type: "string", description: "buy or sell" },
          quantity: { type: "number" },
          price: { type: "number", description: "Limit price. Required." },
        },
        required: ["side", "quantity", "price"],
      },
    },
  },
];

const FILE_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a UTF-8 text file inside the workspace. Use offset and limit for large files. Lines are 1-based.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the workspace root" },
          offset: { type: "integer", description: "1-based start line. Defaults to 1." },
          limit: { type: "integer", description: "Maximum lines, 1-400. Defaults to 200." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace an exact snippet in a file. old_string must match the file exactly, including indentation, and must occur once unless replace_all is true. Read the file first.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a text file. Prefer edit_file for existing files. Parent directories are created.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List one directory. Does not recurse.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory relative to the workspace. Defaults to the root." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search file contents with a Rust regular expression. Skips dependency and build directories. Returns at most 150 matches.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "File or directory to search. Defaults to the workspace root." },
          glob: { type: "string", description: "Optional glob such as *.rs or src/**/*.ts" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "Find files by glob, for example **/*.ts. A pattern without a slash searches the whole workspace.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a non-interactive PowerShell command inside the workspace. No user input is available. Default timeout is 120 seconds.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string", description: "Working directory relative to the workspace." },
          timeout_sec: { type: "integer" },
        },
        required: ["command"],
      },
    },
  },
];

const SKILL_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_skill",
      description:
        "Read one skill's instructions by its exact name. Call it before following a skill listed in the prompt.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
];

const MEMORY_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_memory",
      description:
        "Read the full local auto memory. The prompt only includes the start of the index. Use this when you need an older note.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Append one note to local auto memory. Call only when the user corrects you or explicitly asks you to remember. Do not store facts you can read from the code or project instructions.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string" },
        },
        required: ["note"],
      },
    },
  },
];

export type AgentMode = "chat" | "market" | "work";

interface TurnContext {
  instructions: string;
  instructionPath: string;
  memory: string;
  skills: string;
}

const EMPTY_CONTEXT: TurnContext = { instructions: "", instructionPath: "", memory: "", skills: "" };

interface RunOptions {
  messages: ChatMessage[];
  workspace: string | null;
  mode: AgentMode;
  permissionMode: PermissionMode;
  allows: () => string[];
  shouldStop: () => boolean;
  approve: (request: ApprovalRequest) => Promise<boolean>;
  onMessages: (messages: ChatMessage[]) => void;
  onStatus: (label: string | null) => void;
  onWorkspaceChanged: () => void;
}

export async function runAgent(options: RunOptions): Promise<void> {
  let current = options.messages.slice();
  const publish = (next: ChatMessage[]) => {
    current = next;
    options.onMessages(next);
  };
  const upsert = (message: ChatMessage) => {
    const index = current.findIndex((item) => item.id === message.id);
    const next = current.slice();
    if (index === -1) next.push(message);
    else next[index] = message;
    publish(next);
  };

  let context = await loadContext(options);
  let api = toApi(current, options.workspace, options.mode, context);

  for (let round = 0; round < 30; round += 1) {
    if (options.shouldStop()) return;
    const compacted = await compactIfNeeded(current, options, context);
    if (compacted !== current) {
      current = compacted;
      publish(current);
      context = await loadContext(options);
    }
    if (options.shouldStop()) return;
    api = toApi(current, options.workspace, options.mode, context);
    options.onStatus(t("status.thinking"));
    const outcome = await streamAssistant(api, upsert, options);
    if (!outcome) return;
    if (outcome.kind === "stop") return;
    if (outcome.kind === "done") return;
    const stopped = await runCalls(outcome.toolCalls, upsert, options);
    if (stopped) return;
    api = toApi(current, options.workspace, options.mode, context);
  }

  if (options.shouldStop()) return;
  upsert({
    id: uid(),
    role: "assistant",
    content: t("status.limit"),
    status: "done",
  });
}

const PARALLEL_TOOLS = new Set([
  "read_file",
  "list_dir",
  "grep",
  "glob",
  "search_securities",
  "quote_security",
  "security_history",
  "paper_account",
  "read_memory",
  "read_skill",
]);

async function runCalls(
  calls: ToolCall[],
  upsert: (message: ChatMessage) => void,
  options: RunOptions,
): Promise<boolean> {
  let index = 0;
  while (index < calls.length) {
    if (options.shouldStop()) {
      for (const call of calls.slice(index)) upsert(toolMessage(call, t("status.stopped"), "denied"));
      return true;
    }
    if (PARALLEL_TOOLS.has(calls[index].name)) {
      const batch: ToolCall[] = [];
      while (index < calls.length && PARALLEL_TOOLS.has(calls[index].name)) {
        batch.push(calls[index]);
        index += 1;
      }
      const runnable: ToolCall[] = [];
      for (const call of batch) {
        const denied = denyReason(call);
        if (denied) {
          upsert(toolMessage(call, denied, "denied"));
          continue;
        }
        runnable.push(call);
      }
      const running = runnable.map((call) => toolMessage(call, "", "running"));
      for (const message of running) upsert(message);
      const results = await Promise.all(runnable.map((call) => executeTool(call, options)));
      runnable.forEach((_, slot) => {
        const executed = results[slot];
        upsert({
          ...running[slot],
          content: executed.text,
          status: executed.ok ? "done" : "error",
          change: executed.change,
        });
      });
      continue;
    }

    const call = calls[index];
    index += 1;
    const denied = denyReason(call);
    if (denied) {
      upsert(toolMessage(call, denied, "denied"));
      continue;
    }
    const approval = approvalFor(call, options.permissionMode, options.allows());
    let allowed = true;
    if (approval) {
      options.onStatus(t("status.wait"));
      allowed = await options.approve(approval);
    }
    if (!allowed || options.shouldStop()) {
      const text = options.shouldStop() ? t("status.stopped") : t("status.rejected");
      upsert(toolMessage(call, text, "denied"));
      if (options.shouldStop()) return true;
      continue;
    }
    options.onStatus(toolLabel(call));
    const running = toolMessage(call, "", "running");
    upsert(running);
    const executed = await executeTool(call, options);
    upsert({
      ...running,
      content: executed.text,
      status: executed.ok ? "done" : "error",
      change: executed.change,
    });
    if (executed.ok && (call.name === "write_file" || call.name === "edit_file")) {
      options.onWorkspaceChanged();
    }
  }
  return false;
}

async function loadContext(options: RunOptions): Promise<TurnContext> {
  const scope = options.mode === "work" ? options.workspace : null;
  let instructions = "";
  let instructionPath = "";
  if (scope) {
    try {
      const found = await projectInstructions();
      if (found) {
        instructions = found.content;
        instructionPath = found.path;
      }
    } catch {
      instructions = "";
    }
  }
  let memory = "";
  try {
    memory = await memoryIndex(scope);
  } catch {
    memory = "";
  }
  let skills = "";
  try {
    skills = await skillIndex(scope);
  } catch {
    skills = "";
  }
  return { instructions, instructionPath, memory, skills };
}

async function compactIfNeeded(
  current: ChatMessage[],
  options: RunOptions,
  context: TurnContext,
): Promise<ChatMessage[]> {
  const size = JSON.stringify(toApi(current, options.workspace, options.mode, context)).length;
  if (size < 120_000 || current.length < 8) return current;
  const tail = current.slice(-6);
  const head = current.slice(0, -6);
  if (head.length < 2) return current;
  options.onStatus(t("status.compact"));
  try {
    const result = await completeChat(
      [
        {
          role: "system",
          content: t("compact.ask"),
        },
        { role: "user", content: head.map(lineForSummary).join("\n\n").slice(0, 80_000) },
      ],
      [],
      () => undefined,
    );
    if (options.shouldStop() || result.cancelled || result.error) return current;
    const summary = result.content.trim();
    if (!summary) return current;
    const next: ChatMessage[] = [
      { id: uid(), role: "assistant", kind: "compact", content: summary, status: "done" },
      ...tail,
    ];
    return next;
  } catch {
    return current;
  }
}

function lineForSummary(message: ChatMessage): string {
  const text = message.content.replace(/\s+/g, " ").trim().slice(0, 2_000);
  const tools = message.toolCalls?.map((call) => call.name).filter(Boolean).join(", ");
  return `[${message.kind === "compact" ? t("fmt.summary") : message.role}] ${text}${tools ? ` ${t("fmt.tools")}:${tools}` : ""}`;
}

async function streamAssistant(
  api: ApiMessage[],
  upsert: (message: ChatMessage) => void,
  options: RunOptions,
  withTools = true,
): Promise<{ kind: "tools"; toolCalls: ToolCall[] } | { kind: "done" } | { kind: "stop" } | null> {
  const draftId = uid();
  let draft: ChatMessage = {
    id: draftId,
    role: "assistant",
    content: "",
    reasoning: "",
    status: "streaming",
  };
  const calls: ToolCall[] = [];
  upsert(draft);

  const onEvent = (event: StreamEvent) => {
    if (event.type === "text") {
      draft = { ...draft, content: draft.content + event.text };
    } else if (event.type === "reasoning") {
      draft = { ...draft, reasoning: (draft.reasoning ?? "") + event.text };
    } else if (event.type === "toolDelta") {
      while (calls.length <= event.index) {
        calls.push({ id: "", name: "", arguments: "" });
      }
      const slot = calls[event.index];
      if (event.id) slot.id = event.id;
      if (event.name) slot.name += event.name;
      if (event.arguments) slot.arguments += event.arguments;
      draft = {
        ...draft,
        toolCalls: calls.filter((call) => call.name || call.id).map((call) => ({ ...call })),
      };
    }
    upsert(draft);
  };

  try {
    const tools = withTools ? toolsFor(options.mode, options.workspace) : [];
    let nextApi = api;
    let result = await completeChat(nextApi, tools, onEvent);
    for (let extra = 0; extra < 2; extra += 1) {
      const pending = (result.toolCalls ?? []).filter((call) => call.name);
      if (result.cancelled || options.shouldStop() || result.error || pending.length > 0) break;
      const written = result.content || draft.content;
      if (result.finishReason === "content_filter" || !replyLooksCut(written, result.finishReason)) break;
      calls.length = 0;
      nextApi = [
        ...nextApi,
        { role: "assistant", content: written },
        { role: "user", content: "Continue from the exact point the reply stopped. Write only the missing part, and do not repeat what is already written." },
      ];
      const before = draft.content.length;
      result = await completeChat(nextApi, tools, onEvent);
      if (result.content && draft.content.length === before) {
        draft = { ...draft, content: draft.content + result.content };
      }
    }
    const toolCalls = (result.toolCalls ?? []).filter((call) => call.name);
    if (result.cancelled || options.shouldStop()) {
      upsert({
        ...draft,
        content: result.content || draft.content,
        reasoning: result.reasoning || draft.reasoning,
        toolCalls: undefined,
        status: "done",
      });
      return { kind: "stop" };
    }
    if (result.error && toolCalls.length === 0) {
      upsert({
        ...draft,
        content: draft.content || result.content || result.error,
        reasoning: result.reasoning || draft.reasoning,
        status: "error",
        toolCalls: undefined,
      });
      return null;
    }
    let content = draft.content || result.content;
    if (result.finishReason === "content_filter") content = `${content}\n\n${t("fmt.cutByProvider")}`.trim();
    const reasoning = draft.reasoning || result.reasoning || "";
    const visibleTools = withTools ? toolCalls : [];
    upsert({
      ...draft,
      content: content || (visibleTools.length === 0 ? reasoning : content),
      reasoning,
      toolCalls: visibleTools.length ? visibleTools : undefined,
      status: "done",
    });
    if (visibleTools.length === 0) return { kind: "done" };
    return { kind: "tools", toolCalls: visibleTools };
  } catch (error) {
    upsert({
      ...draft,
      content: draft.content || errorText(error),
      status: "error",
      toolCalls: undefined,
    });
    return null;
  }
}

export function approvalFor(call: ToolCall, mode: PermissionMode, allows: string[] = []): ApprovalRequest | null {
  if (call.name === "broker_order") {
    const args = argsOf(call);
    const selling = str(args.side) === "sell" || str(args.side) === "卖出";
    const target = str(args.query) || str(args.secid) || t("approval.targetMissing");
    const quantity = typeof args.quantity === "number" ? args.quantity : "";
    const price = typeof args.price === "number" ? args.price : "";
    return {
      call,
      title: selling ? t("approval.liveSell") : t("approval.liveBuy"),
      subtitle: t("approval.liveNote"),
      command: `${target}  ${quantity}  ${price}`,
    };
  }
  if (call.name === "paper_order") {
    const args = argsOf(call);
    const selling = str(args.side) === "sell";
    const target = str(args.query) || str(args.secid) || t("approval.targetMissing");
    const quantity = typeof args.quantity === "number" ? args.quantity : "";
    return {
      call,
      title: selling ? t("approval.paperSell") : t("approval.paperBuy"),
      subtitle: t("approval.paperNote"),
      command: `${target}  ${quantity}`,
    };
  }
  if (call.name === "price_alert") {
    const args = argsOf(call);
    const side = str(args.side);
    const selling = side === "sell" || side === "卖出";
    const buying = side === "buy" || side === "买入";
    if (str(args.action) !== "add" || (!selling && !buying)) return null;
    const target = str(args.query) || str(args.secid) || t("approval.targetMissing");
    const quantity = typeof args.quantity === "number" ? args.quantity : "";
    return {
      call,
      title: selling ? t("approval.paperPlanSell") : t("approval.paperPlanBuy"),
      subtitle: t("approval.paperPlanNote"),
      command: `${target}  ${alertCommand(args)}  ${quantity}`,
    };
  }
  const key = allowKey(call);
  if (key && allows.includes(key)) return null;
  if (mode === "full") return null;
  if (mode === "auto_edit" && (call.name === "write_file" || call.name === "edit_file")) return null;
  if (call.name !== "write_file" && call.name !== "edit_file" && call.name !== "run_command") return null;
  const args = argsOf(call);
  if (call.name === "run_command") {
    const command = str(args.command);
    const cwd = str(args.cwd);
    return {
      call,
      title: t("approval.command"),
      subtitle: cwd ? t("approval.cwd", { cwd }) : t("approval.cwdRoot"),
      command,
      allowKey: key ?? undefined,
    };
  }
  if (call.name === "edit_file") {
    return {
      call,
      title: t("approval.edit"),
      subtitle: str(args.path) || t("approval.pathMissing"),
      before: str(args.old_string),
      after: str(args.new_string),
      allowKey: key ?? undefined,
    };
  }
  return {
    call,
    title: t("approval.write"),
    subtitle: str(args.path) || t("approval.pathMissing"),
    after: str(args.content),
    allowKey: key ?? undefined,
  };
}

function denyReason(call: ToolCall): string | null {
  const args = argsOf(call);
  if ((call.name === "write_file" || call.name === "edit_file") && touchesGit(str(args.path))) {
    return t("deny.git");
  }
  if (call.name !== "run_command") return null;
  const command = str(args.command);
  const removes = /\b(rm|del|rmdir|remove-item|git\s+clean)\b/i.test(command);
  if (removes && /\.git\b/i.test(command)) return t("deny.gitClean");
  if (/\b(settings\.json|paper-account\.json)\b/i.test(command) && /\b(rm|del|rmdir|remove-item|clear-content|set-content)\b/i.test(command)) {
    return t("deny.config");
  }
  return null;
}

function allowKey(call: ToolCall): string | null {
  const args = argsOf(call);
  if (call.name === "run_command") {
    const command = str(args.command).trim();
    return command ? `command:${command}` : null;
  }
  if (call.name === "edit_file" || call.name === "write_file") {
    const path = str(args.path).trim().replace(/\\/g, "/");
    return path ? `file:${call.name}:${path}` : null;
  }
  return null;
}

function touchesGit(path: string): boolean {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .some((part) => part === ".git");
}

async function executeTool(call: ToolCall, options: RunOptions): Promise<{ text: string; ok: boolean; change?: FileChange }> {
  const args = argsOf(call);
  try {
    switch (call.name) {
      case "read_file": {
        const path = str(args.path);
        if (!path) return { text: t("missing.path"), ok: false };
        const result = await readFile(path, num(args.offset), num(args.limit));
        return { text: formatRead(result), ok: true };
      }
      case "edit_file": {
        const path = str(args.path);
        if (!path) return { text: t("missing.path"), ok: false };
        const result = await editFile(path, str(args.old_string), str(args.new_string), bool(args.replace_all));
        return {
          text: t("tool.edited", { path: result.path, n: result.replacements }),
          ok: true,
          change: {
            path: result.path,
            kind: "edit",
            created: false,
            before: result.previous,
            omitted: result.previousOmitted,
            removed: str(args.old_string).slice(0, 4000),
            added: str(args.new_string).slice(0, 4000),
          },
        };
      }
      case "write_file": {
        const path = str(args.path);
        if (!path) return { text: t("missing.path"), ok: false };
        const content = str(args.content);
        const result = await writeFile(path, content);
        return {
          text: t("tool.wrote", { path: result.path, n: result.bytes }),
          ok: true,
          change: {
            path: result.path,
            kind: "write",
            created: result.created,
            before: result.previous,
            omitted: result.previousOmitted,
            removed: result.created ? "" : (result.previous ?? "").slice(0, 4000),
            added: content.slice(0, 4000),
          },
        };
      }
      case "list_dir": {
        const result = await listDir(str(args.path) || undefined);
        return { text: formatList(result), ok: true };
      }
      case "grep": {
        const pattern = str(args.pattern);
        if (!pattern) return { text: t("missing.pattern"), ok: false };
        const result = await grepWorkspace(pattern, str(args.path) || undefined, str(args.glob) || undefined);
        return { text: formatGrep(result), ok: true };
      }
      case "glob": {
        const pattern = str(args.pattern);
        if (!pattern) return { text: t("missing.pattern"), ok: false };
        const result = await globWorkspace(pattern);
        return { text: formatGlob(result), ok: true };
      }
      case "run_command": {
        const command = str(args.command);
        if (!command) return { text: t("missing.command"), ok: false };
        const result = await runCommand(command, str(args.cwd) || undefined, num(args.timeout_sec));
        return { text: formatCommand(result), ok: result.exitCode === 0 && !result.timedOut };
      }
      case "search_securities": {
        const query = str(args.query);
        if (!query) return { text: t("missing.query"), ok: false };
        return { text: formatSearch(await searchSecurities(query)), ok: true };
      }
      case "quote_security": {
        const secid = str(args.secid);
        if (!secid) return { text: t("missing.secid"), ok: false };
        return { text: formatQuote(await quoteSecurity(secid)), ok: true };
      }
      case "security_history": {
        const secid = str(args.secid);
        if (!secid) return { text: t("missing.secid"), ok: false };
        return { text: formatHistory(await securityHistory(secid, num(args.days))), ok: true };
      }
      case "paper_account":
        return { text: formatAccount(await paperAccount()), ok: true };
      case "paper_order": {
        const side = str(args.side);
        const quantity = floatOf(args.quantity);
        if (!side) return { text: t("missing.side"), ok: false };
        if (quantity === undefined) return { text: t("missing.quantity"), ok: false };
        const result = await paperOrder(side, quantity, str(args.query) || undefined, str(args.secid) || undefined);
        return { text: formatOrder(result), ok: true };
      }
      case "broker_status":
        return { text: formatBrokerStatus(await brokerStatus()), ok: true };
      case "broker_account":
        return { text: formatBrokerAccount(await brokerAccount()), ok: true };
      case "broker_order": {
        const side = str(args.side);
        const quantity = floatOf(args.quantity);
        const price = floatOf(args.price);
        if (!side) return { text: t("missing.side"), ok: false };
        if (quantity === undefined) return { text: t("missing.quantity"), ok: false };
        if (price === undefined) return { text: t("missing.price"), ok: false };
        const result = await brokerOrder(side, quantity, price, str(args.query) || undefined, str(args.secid) || undefined);
        return { text: formatBrokerOrder(result), ok: true };
      }
      case "price_alert": {
        const action = str(args.action);
        if (action === "list") return { text: formatAlerts(await listPriceAlerts()), ok: true };
        if (action === "remove") {
          const id = str(args.id);
          if (!id) return { text: t("missing.alertId"), ok: false };
          await removePriceAlert(id);
          return { text: t("alert.removed"), ok: true };
        }
        if (action !== "add") return { text: t("missing.alertAction"), ok: false };
        const kind = str(args.kind);
        if (!kind) return { text: t("missing.alertKind"), ok: false };
        const saved = await addPriceAlert({
          query: str(args.query) || undefined,
          secid: str(args.secid) || undefined,
          kind,
          price: floatOf(args.price),
          low: floatOf(args.low),
          high: floatOf(args.high),
          note: str(args.note) || undefined,
          side: str(args.side) || undefined,
          quantity: floatOf(args.quantity),
        });
        return { text: formatAlert(saved), ok: true };
      }
      case "watch_security": {
        const action = str(args.action);
        if (action === "list") {
          const items = await listWatch();
          if (items.length === 0) return { text: t("watch.empty"), ok: true };
          return { text: items.map((item) => t("watch.line", { name: item.name, code: item.code, kind: item.kind })).join("\n"), ok: true };
        }
        if (action === "remove") {
          const secid = str(args.secid);
          if (!secid) return { text: t("missing.secid"), ok: false };
          await removeWatch(secid);
          return { text: t("watch.removed"), ok: true };
        }
        if (action !== "add") return { text: t("missing.alertAction"), ok: false };
        const saved = await addWatch(str(args.query) || undefined, str(args.secid) || undefined);
        return { text: t("watch.added", { name: saved.name, code: saved.code }), ok: true };
      }
      case "read_memory": {
        const scope = options.mode === "work" ? options.workspace : null;
        return { text: localizeBackend(await readMemoryNote(scope)), ok: true };
      }
      case "remember": {
        const note = str(args.note).trim();
        if (!note) return { text: t("missing.note"), ok: false };
        const scope = options.mode === "work" ? options.workspace : null;
        return { text: localizeBackend(await rememberNote(scope, note)), ok: true };
      }
      case "read_skill": {
        const name = str(args.name).trim();
        if (!name) return { text: t("missing.skill"), ok: false };
        const scope = options.mode === "work" ? options.workspace : null;
        return { text: await readSkill(scope, name), ok: true };
      }
      default:
        return { text: t("tool.unknown", { name: call.name }), ok: false };
    }
  } catch (error) {
    return { text: errorText(error), ok: false };
  }
}

function toApi(messages: ChatMessage[], workspace: string | null, mode: AgentMode, context: TurnContext = EMPTY_CONTEXT): ApiMessage[] {
  const api: ApiMessage[] = [
    { role: "system", content: systemPrompt(mode, workspace, context) },
  ];
  for (const message of messages) {
    if (message.status === "streaming" || message.status === "running") continue;
    if (message.kind === "compact") {
      api.push({ role: "user", content: t("compact.prefix", { summary: message.content }) });
      continue;
    }
    if (message.role === "user") {
      const images = (message.images ?? []).filter((image) => image.dataUrl);
      if (images.length > 0) {
        const parts: Extract<ApiContent, unknown[]> = [];
        if (message.content) parts.push({ type: "text", text: message.content });
        for (const image of images) parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
        api.push({ role: "user", content: parts });
      } else {
        api.push({ role: "user", content: message.content });
      }
    } else if (message.role === "assistant") {
      const item: ApiMessage = { role: "assistant", content: message.content || null };
      if (message.toolCalls && message.toolCalls.length > 0) {
        item.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: call.arguments || "{}",
          },
        }));
      }
      api.push(item);
    } else if (message.role === "tool" && message.toolCallId) {
      api.push({
        role: "tool",
        tool_call_id: message.toolCallId,
        content: cap(message.content || ""),
      });
    }
  }
  return trimApi(api);
}

function toolsFor(mode: AgentMode, workspace: string | null) {
  const memory = [...MEMORY_TOOLS, ...SKILL_TOOLS];
  if (mode === "market") return [...MARKET_TOOLS, ...memory];
  if (mode === "work" && workspace) return [...FILE_TOOLS, ...memory];
  return memory;
}

function systemPrompt(mode: AgentMode, workspace: string | null, context: TurnContext = EMPTY_CONTEXT): string {
  const chat = t("mode.chat");
  const market = t("mode.market");
  const work = t("mode.work");
  const shared = [
    "You are Ticker, a finance agent. The user is working with you on their own machine.",
    "Reply in the user's language.",
    "The user may paste images. Look at those images before answering.",
    "In chat and market, attached files are already included as text in the user message. In work, attachments are project paths to read with tools.",
    t("prompt.modes", { chat, market, work }),
    "Auto memory is a local note file. The index is included below when it exists. Call read_memory for the rest. Call remember only when the user corrects you or explicitly asks you to remember. Do not store facts you can read from the code or the project instructions.",
  ];
  let body: string[];
  if (mode === "chat") {
    body = [
      ...shared,
      t("prompt.chat", { chat }),
      t("prompt.chatMarket", { market }),
      t("prompt.chatWork", { work }),
    ];
  } else if (mode === "market") {
    body = [
      ...shared,
      t("prompt.market", { market }),
      t("prompt.marketWork", { work }),
      "Before a market opinion, call search_securities and then quote_security plus security_history. Cite those numbers. Say what would change the view. This is not investment advice, and prices can be delayed.",
      "paper_account is a local simulated book that starts with 100000 CNY. paper_order fills there at the latest price and never reaches a broker.",
      "Call paper_order only when the user explicitly asks to buy or sell in the simulated account. Stock buys are multiples of 100 shares. Bond buys are multiples of 10. After a fill, say clearly that it is simulated.",
      "When the user asks only to be reminded at a price, call price_alert without side. When the user explicitly asks the simulated account to buy or sell at a price, call price_alert with side and quantity. That asks once, then fills at the latest price while Ticker is open. Never use it for 实盘.",
      "When the user asks to watch a security, 盯盘, or keep it on a board, call watch_security add. The market view refreshes its price while Ticker is open. Say that nothing was ordered.",
      "Call broker_status before a 实盘 decision. When it is not connected, give one action from the quote and recent bars: buy, sell, or wait. Include the code, price, and quantity, and say the order was not sent.",
      "When broker_status is connected, call broker_account before choosing a quantity. Call broker_order only when the user explicitly says to send the order. It is a limit order and the app asks for confirmation. Say it was submitted only after the tool returns an order id. Never use paper_order for 实盘.",
    ];
  } else if (!workspace) {
    body = [
      ...shared,
      t("prompt.workEmpty", { work }),
      "File and command tools are unavailable until the user chooses a repository.",
      t("prompt.workMarket", { market }),
    ];
  } else {
    body = [
      ...shared,
      t("prompt.work", { work }),
      `Workspace root: ${workspace}`,
      "Rules:",
      "- Inspect the codebase with tools before changing it. Do not invent file contents.",
      "- Paths are relative to the workspace root. Access outside it is rejected.",
      "- Prefer edit_file for existing files. old_string must be an exact, unique snippet unless replace_all is true.",
      "- Use write_file for new files or full rewrites.",
      "- Commands run in Windows PowerShell, non-interactively, inside the workspace.",
      "- After a code change, run the smallest relevant check when the user asked for a working result.",
      "- Do not repeat large tool dumps. Summarize what changed and what the user should verify.",
      "- If a tool fails or the user denies it, adapt. Do not repeat a denied action.",
      `- ${t("prompt.workMarket", { market })}`,
    ];
  }
  return [body.join("\n"), contextBlock(context)].filter(Boolean).join("\n\n");
}

function contextBlock(context: TurnContext): string {
  const parts: string[] = [];
  if (context.instructions) {
    parts.push(`Project instructions from ${context.instructionPath}. Follow them. They are reloaded from disk after compaction:\n${context.instructions}`);
  }
  if (context.memory.trim()) {
    parts.push(`Auto memory index:\n${context.memory}`);
  }
  if (context.skills.trim()) {
    parts.push(
      `Skills. When the user's task matches one, call read_skill with its exact name before following it. Do not invent a skill that is not listed.\n${context.skills}`,
    );
  }
  return parts.join("\n\n");
}

function trimApi(messages: ApiMessage[]): ApiMessage[] {
  const raw = JSON.stringify(messages);
  if (raw.length < 120_000) return messages;
  return messages.map((message, index) => {
    if (
      message.role === "tool" &&
      index < messages.length - 6 &&
      message.content &&
      message.content.length > 1_500
    ) {
      return { ...message, content: `${message.content.slice(0, 1_500)}\n${t("fmt.oldTools")}` };
    }
    return message;
  });
}

function toolMessage(call: ToolCall, content: string, status: ChatMessage["status"]): ChatMessage {
  return {
    id: uid(),
    role: "tool",
    content,
    toolCallId: call.id,
    toolName: call.name,
    args: call.arguments,
    status,
  };
}

function formatRead(result: ReadFileResult): string {
  const lines = result.content === "" ? [] : result.content.split("\n");
  const numbered = lines
    .map((line, index) => `${String(result.startLine + index).padStart(6, " ")}|${line}`)
    .join("\n");
  const range = lines.length === 0
    ? t("fmt.emptyFile", { n: result.totalLines })
    : `${result.startLine}-${result.endLine} / ${result.totalLines}`;
  return cap(`${result.path}  ${range}${result.truncated ? t("fmt.more") : ""}\n${numbered}`);
}

function formatList(entries: DirEntry[]): string {
  if (entries.length === 0) return t("fmt.emptyDir");
  return cap(
    entries
      .map((entry) =>
        entry.isDir ? `dir   ${entry.path}/` : `file  ${entry.path}  ${formatBytes(entry.size)}`,
      )
      .join("\n"),
  );
}

function formatGrep(result: GrepResult): string {
  if (result.matches.length === 0) {
    return result.truncated ? t("fmt.noMatchCut") : t("fmt.noMatch");
  }
  const body = result.matches.map((hit) => `${hit.path}:${hit.line}: ${hit.text}`).join("\n");
  return cap(result.truncated ? `${body}\n${t("fmt.cut")}` : body);
}

function formatGlob(result: GlobResult): string {
  if (result.files.length === 0) return result.truncated ? t("fmt.noFileCut") : t("fmt.noFile");
  return cap(result.truncated ? `${result.files.join("\n")}\n${t("fmt.cut")}` : result.files.join("\n"));
}

function formatCommand(result: CommandOutput): string {
  const flags = [
    `exit ${result.exitCode}`,
    result.timedOut ? t("fmt.timeout") : "",
    result.truncated ? t("fmt.outputCut") : "",
    `${result.durationMs} ms`,
  ].filter(Boolean);
  const parts = [flags.join(" · ")];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  return cap(parts.join("\n"));
}

function formatSearch(result: SecuritySearch): string {
  if (result.items.length === 0) return t("fmt.notFound");
  const lines = result.items.map((item) => `${item.code}  ${item.name}  ${item.kind}  ${item.secid}`);
  return cap(result.truncated ? `${lines.join("\n")}\n${t("fmt.moreHits")}` : lines.join("\n"));
}

function formatQuote(quote: SecurityQuote): string {
  const parts = [
    `${quote.name}  ${quote.code}  ${quote.secid}`,
    t("fmt.quoteLine", { price: numText(quote.price), change: signed(quote.change), pct: signed(quote.changePct) }),
    t("fmt.range", { open: numText(quote.open), high: numText(quote.high), low: numText(quote.low), prev: numText(quote.prevClose) }),
    t("fmt.amount", { amount: yuan(quote.amount) }),
  ];
  if (quote.turnover != null) parts.push(t("fmt.turnover", { value: numText(quote.turnover) }));
  if (quote.pe != null) parts.push(t("fmt.pe", { value: numText(quote.pe) }));
  if (quote.marketCap != null) parts.push(t("fmt.cap", { value: yuan(quote.marketCap) }));
  parts.push(t("fmt.source"));
  return parts.join("\n");
}

function formatHistory(history: SecurityHistory): string {
  const lines = history.bars.map(
    (bar) =>
      t("fmt.bar", {
        date: bar.date,
        open: numText(bar.open),
        close: numText(bar.close),
        high: numText(bar.high),
        low: numText(bar.low),
        pct: signed(bar.changePct),
        amount: yuan(bar.amount),
      }),
  );
  return cap(`${t("fmt.daily", { name: history.name, code: history.code })}\n${lines.join("\n")}`);
}

function formatAccount(account: PaperAccount): string {
  const lines = [t("fmt.paper"), t("fmt.cash", { cash: account.cash.toFixed(2) })];
  if (account.positions.length === 0) lines.push(t("fmt.noPosition"));
  for (const position of account.positions) {
    const price = position.price == null ? t("fmt.noPrice") : t("fmt.price", { price: numText(position.price) });
    const value = position.price == null ? "" : t("fmt.mv", { value: (position.price * position.quantity).toFixed(2) });
    lines.push(
      t("fmt.position", {
        name: position.name,
        code: position.code,
        kind: position.kind,
        qty: trimQty(position.quantity),
        cost: numText(position.cost),
        price,
        value,
      }),
    );
  }
  return lines.join("\n");
}

function alertCommand(args: Record<string, unknown>): string {
  const kind = str(args.kind);
  const price = floatOf(args.price);
  const low = floatOf(args.low);
  const high = floatOf(args.high);
  if (kind === "above" || kind === "突破" || kind === "高于") return t("alert.above", { price: numText(price ?? 0) });
  if (kind === "between" || kind === "区间" || kind === "回踩") return t("alert.between", { low: numText(low ?? 0), high: numText(high ?? 0) });
  return t("alert.below", { price: numText(price ?? 0) });
}

function alertRule(alert: PriceAlert): string {
  if (alert.kind === "above") return t("alert.above", { price: numText(alert.price ?? 0) });
  if (alert.kind === "between") return t("alert.between", { low: numText(alert.low ?? 0), high: numText(alert.high ?? 0) });
  return t("alert.below", { price: numText(alert.price ?? 0) });
}

function formatAlert(alert: PriceAlert): string {
  const ordered = alert.side === "buy" || alert.side === "sell";
  const verb = alert.side === "sell" ? t("approval.paperSell") : t("approval.paperBuy");
  const lines = [
    ordered
      ? t("alert.savedOrder", { name: alert.name, code: alert.code, rule: alertRule(alert), verb, qty: trimQty(alert.quantity ?? 0) })
      : t("alert.saved", { name: alert.name, code: alert.code, rule: alertRule(alert) }),
  ];
  if (alert.note) lines.push(alert.note);
  lines.push(ordered ? t("alert.whileOpenOrder") : t("alert.whileOpen"));
  return lines.join("\n");
}

function formatAlerts(alerts: PriceAlert[]): string {
  if (alerts.length === 0) return t("alert.empty");
  return alerts
    .map((alert) => {
      const state = alert.armed ? t("alert.watching") : alert.outcome === "filled" ? t("alert.filledState") : alert.outcome === "failed" ? t("alert.failedState") : t("alert.done");
      const note = alert.note ? `  ${alert.note}` : "";
      const order = alert.side === "buy" || alert.side === "sell"
        ? `  ${alert.side === "sell" ? t("approval.paperSell") : t("approval.paperBuy")} ${trimQty(alert.quantity ?? 0)}`
        : "";
      return `${state}  ${alert.name} ${alert.code}  ${alertRule(alert)}${order}${note}  ${alert.id}`;
    })
    .join("\n");
}

function formatBrokerStatus(status: BrokerStatus): string {
  if (!status.connected) return localizeBackend(status.message || t("fmt.brokerOff"));
  return t("fmt.brokerOn", { account: status.account || "—" });
}

function formatBrokerAccount(account: BrokerAccount): string {
  const lines = [
    t("fmt.broker", { account: account.account || "—" }),
    t("fmt.cash", { cash: account.cash.toFixed(2) }),
    t("fmt.brokerTotal", { total: account.total.toFixed(2), value: account.marketValue.toFixed(2) }),
  ];
  if (account.positions.length === 0) lines.push(t("fmt.noPosition"));
  for (const position of account.positions) {
    lines.push(
      t("fmt.brokerPosition", {
        name: position.name || position.code,
        code: position.code,
        qty: trimQty(position.quantity),
        available: trimQty(position.available),
        cost: numText(position.cost),
        value: position.marketValue.toFixed(2),
      }),
    );
  }
  return lines.join("\n");
}

function formatBrokerOrder(result: BrokerOrderResult): string {
  const verb = result.side === "sell" ? t("approval.liveSell") : t("approval.liveBuy");
  return `${t("fmt.live", {
    verb,
    name: result.name,
    code: result.code,
    qty: trimQty(result.quantity),
    price: numText(result.price),
    id: result.orderId,
  })}\n${t("fmt.liveSent")}`;
}

function formatOrder(result: PaperOrderResult): string {
  const verb = result.side === "sell" ? t("approval.paperSell") : t("approval.paperBuy");
  return `${t("fmt.fill", { verb, name: result.name, code: result.code, qty: trimQty(result.quantity), price: numText(result.price) })}\n${t("fmt.sim")}\n${formatAccount(result.account)}`;
}

function numText(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 1) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function signed(value: number): string {
  const text = numText(value);
  return value > 0 ? `+${text}` : text;
}

function yuan(value: number): string {
  const abs = Math.abs(value);
  if (getLocale() === "en") {
    if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
    return value.toFixed(2);
  }
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return value.toFixed(2);
}

function trimQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function floatOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function replyLooksCut(text: string, finish?: string | null): boolean {
  if (finish === "length") return true;
  if (finish === "content_filter") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/[：:]$/.test(trimmed)) return true;
  const last = trimmed.split("\n").filter((line) => line.trim()).pop()?.trim() ?? "";
  if (last === "|" || /^\|[^|]*$/.test(last)) return true;
  return /^(#{1,6}\s+\S|\*\*[^*\n]+\*\*)$/.test(last);
}

export function toolLabel(call: ToolCall): string {
  const args = argsOf(call);
  if (call.name === "search_securities") return str(args.query) ? t("tool.look", { name: str(args.query) }) : t("tool.lookBare");
  if (call.name === "quote_security") return str(args.secid) ? t("tool.quote", { name: str(args.secid) }) : t("tool.quoteBare");
  if (call.name === "security_history") return str(args.secid) ? t("tool.bars", { name: str(args.secid) }) : t("tool.barsBare");
  if (call.name === "paper_account") return t("tool.account");
  if (call.name === "broker_status") return t("tool.broker");
  if (call.name === "broker_account") return t("tool.brokerAccount");
  if (call.name === "broker_order") {
    const verb = str(args.side) === "sell" ? t("approval.liveSell") : t("approval.liveBuy");
    return `${verb} ${str(args.query) || str(args.secid) || ""}`.trim();
  }
  if (call.name === "paper_order") {
    const verb = str(args.side) === "sell" ? t("approval.paperSell") : t("approval.paperBuy");
    return `${verb} ${str(args.query) || str(args.secid) || ""}`.trim();
  }
  if (call.name === "price_alert") {
    const action = str(args.action);
    if (action === "list") return t("tool.alertList");
    if (action === "remove") return t("tool.alertRemove");
    return t("tool.alert");
  }
  if (call.name === "watch_security") {
    const action = str(args.action);
    if (action === "list") return t("tool.watchList");
    if (action === "remove") return t("tool.watchRemove");
    const name = str(args.query) || str(args.secid);
    return name ? t("tool.watch", { name }) : t("tool.watchBare");
  }
  if (call.name === "read_memory") return t("tool.note");
  if (call.name === "remember") return t("tool.remember");
  if (call.name === "read_skill") return str(args.name) ? t("tool.skill", { name: str(args.name) }) : t("tool.skillBare");
  if (call.name === "run_command") return str(args.command) || "run_command";
  if (typeof args.path === "string" && args.path) return `${call.name}  ${args.path}`;
  if (typeof args.pattern === "string" && args.pattern) return `${call.name}  ${args.pattern}`;
  return call.name;
}

function argsOf(call: ToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.arguments || "{}") as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bool(value: unknown): boolean {
  return value === true;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function cap(text: string, max = 60_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n${t("fmt.output")}`;
}

export function errorText(err: unknown): string {
  if (typeof err === "string") return localizeBackend(err);
  if (err instanceof Error) return localizeBackend(err.message);
  return t("fmt.unknown");
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
