import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { addWatch, brokerStatus, deleteSkill, getBroker, listSkills, listWatch, quoteSecurity, removeWatch, saveBroker, saveSkill, searchSecurities, type SkillEntry } from "./api";
import { highlightCode } from "./highlight";
import { errorText, replyLooksCut, toolLabel } from "./agent";
import { getLocale, isDefaultUserName, setLocale, t, type MessageKey } from "./i18n";
import { displayTitle, repoKey, repoName } from "./session";
import type {
  ApprovalRequest,
  ChatImage,
  ChatMessage,
  FileChange,
  BrokerDraft,
  BrokerKind,
  PermissionMode,
  ReadFileResult,
  SecurityHit,
  SecurityQuote,
  Session,
  SettingsDraft,
  WatchItem,
} from "./types";

function permissionModes(): { id: PermissionMode; label: string }[] {
  return [
    { id: "ask", label: t("perm.ask") },
    { id: "auto_edit", label: t("perm.auto") },
    { id: "full", label: t("perm.full") },
  ];
}

function shownProviderLabel(id: string, fallback: string): string {
  if (id === "qwen") return t("provider.qwen");
  if (id === "zhipu") return t("provider.zhipu");
  if (id === "doubao") return t("provider.doubao");
  if (id === "siliconflow") return t("provider.siliconflow");
  if (id === "ollama") return t("provider.ollama");
  return fallback;
}

function shownModelLabel(label: string): string {
  if (getLocale() !== "en") return label;
  return label
    .split("千问").join("Qwen")
    .split("预览").join("Preview")
    .split("高速").join("High-speed")
    .split("豆包").join("Doubao");
}

const PROVIDERS = [
  {
    id: "qwen",
    label: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen4-max", label: "千问 4 Max" },
      { id: "qwen4-max-preview", label: "千问 4 Max 预览" },
      { id: "qwen3.8-max", label: "千问 3.8 Max" },
      { id: "qwen3.8-max-0902", label: "千问 3.8 Max 0902" },
      { id: "qwen3.8-flash", label: "千问 3.8 Flash" },
      { id: "qwen3.8-omni-flash", label: "千问 3.8 Omni" },
      { id: "qwen3.7-max", label: "千问 3.7 Max" },
      { id: "qwen3.7-plus", label: "千问 3.7 Plus" },
      { id: "qwen3.7-flash", label: "千问 3.7 Flash" },
      { id: "qwen3.6-plus", label: "千问 3.6 Plus" },
      { id: "qwen3.6-flash", label: "千问 3.6 Flash" },
      { id: "qwen3.5-plus", label: "千问 3.5 Plus" },
      { id: "qwen3.5-flash", label: "千问 3.5 Flash" },
      { id: "qwen3.8-27b", label: "千问 3.8 27B", vision: false },
      { id: "qwen3.5-27b", label: "千问 3.5 27B", vision: false },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
      { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", vision: false },
      { id: "deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash 1017", vision: false },
      { id: "glm-5.3", label: "GLM-5.3", vision: false },
      { id: "glm-5.2", label: "GLM-5.2", vision: false },
      { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
      { id: "kimi/kimi-k3", label: "Kimi K3" },
      { id: "MiniMax-M3.1-Flash", label: "MiniMax M3.1 Flash" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-6-astra", label: "GPT-6 Astra" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", label: "GPT-6.1 Terra" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
    ],
  },
  {
    id: "claude",
    label: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    ],
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      { id: "gemini-4-argon", label: "Gemini 4 Argon" },
      { id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: [
      { id: "deepseek-flash", label: "DeepSeek Flash", vision: false },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
    ],
  },
  {
    id: "zhipu",
    label: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-5.3", label: "GLM-5.3", vision: false },
      { id: "glm-5.3-flash", label: "GLM-5.3 Flash" },
      { id: "glm-4.7-flash", label: "GLM-4.7 Flash", vision: false },
    ],
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      { id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro" },
      { id: "kimi-k3.1-pro-highspeed", label: "Kimi K3.1 Pro 高速" },
      { id: "kimi-k3", label: "Kimi K3" },
    ],
  },
  {
    id: "doubao",
    label: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [{ id: "doubao-seed-2-1-pro-260915", label: "豆包 Seed 2.1 Pro" }],
  },
  {
    id: "minimax",
    label: "MiniMax",
    baseUrl: "https://api.minimax.cn/v1",
    models: [
      { id: "MiniMax-M3.1-Flash", label: "MiniMax M3.1 Flash" },
      { id: "MiniMax-M3", label: "MiniMax M3" },
    ],
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash", vision: false },
      { id: "zai-org/GLM-5.3", label: "GLM-5.3", vision: false },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5" },
      { id: "anthropic/claude-opus-5.5", label: "Claude Opus 5.5" },
      { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { id: "openai/gpt-6-astra", label: "GPT-6 Astra" },
    ],
  },
  {
    id: "ollama",
    label: "Ollama 本地",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "qwen3-coder", label: "Qwen3 Coder", vision: false },
      { id: "qwen3-coder-next", label: "Qwen3 Coder Next", vision: false },
    ],
  },
];

export type ModelChoice = {
  provider: string;
  providerLabel: string;
  baseUrl: string;
  id: string;
  label: string;
};

export function modelSeesImages(modelId: string): boolean {
  for (const preset of PROVIDERS) {
    const found = preset.models.find((item) => item.id === modelId);
    if (found) return found.vision !== false;
  }
  const name = modelId.toLowerCase();
  return !name.includes("coder") && !name.includes("deepseek");
}

export function modelChoices(): ModelChoice[] {
  return PROVIDERS.flatMap((preset) =>
    preset.models.map((item) => ({
      provider: preset.id,
      providerLabel: shownProviderLabel(preset.id, preset.label),
      baseUrl: preset.baseUrl,
      id: item.id,
      label: shownModelLabel(item.label),
    })),
  );
}

export function modelOptions(provider: string, current?: string): { id: string; label: string }[] {
  const found = PROVIDERS.find((item) => item.id === provider)?.models;
  const models = found ?? PROVIDERS.flatMap((item) => item.models);
  const labeled = models.map((item) => ({ id: item.id, label: shownModelLabel(item.label) }));
  if (current && !labeled.some((item) => item.id === current)) {
    return [{ id: current, label: current }, ...labeled];
  }
  return labeled;
}

const NO_REPO = "__none__";

export function ModeIcon(props: { mode: "chat" | "market" | "work" }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (props.mode === "chat") {
    return (
      <svg {...common}>
        <path d="M3 3.6h10a1.2 1.2 0 0 1 1.2 1.2v5.2a1.2 1.2 0 0 1-1.2 1.2H7.4L4.6 13.8v-2.6H3A1.2 1.2 0 0 1 1.8 10V4.8A1.2 1.2 0 0 1 3 3.6Z" />
      </svg>
    );
  }
  if (props.mode === "market") {
    return (
      <svg {...common}>
        <path d="M2.5 12.2 6.2 7.8l2.3 2.2L13.5 3.8" />
        <path d="M10.4 3.8H13.5V6.9" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6.2 4.2 2.8 8l3.4 3.8" />
      <path d="M9.8 4.2 13.2 8 9.8 11.8" />
    </svg>
  );
}

function MarketGlyph(props: { kind: "stock" | "fund" | "bond" | "wallet" | "live"; size?: number }) {
  const common = {
    width: props.size ?? 14,
    height: props.size ?? 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (props.kind === "stock") {
    return (
      <svg {...common}>
        <path d="M2.5 12.2 6.2 7.8l2.3 2.2L13.5 3.8" />
        <path d="M10.4 3.8H13.5V6.9" />
      </svg>
    );
  }
  if (props.kind === "fund") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5" />
        <path d="M8 8V3.2" />
        <path d="M8 8l4.1 2.4" />
      </svg>
    );
  }
  if (props.kind === "bond") {
    return (
      <svg {...common}>
        <rect x="3.2" y="2.4" width="9.6" height="11.2" rx="1.4" />
        <path d="M5.6 6h5M5.6 8.4h5M5.6 10.8h3" />
      </svg>
    );
  }
  if (props.kind === "live") {
    return (
      <svg {...common}>
        <path d="M1.8 8.4H4.2L6.1 3.4l2.7 9.2L11 8.4h3.2" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2.2" y="4" width="11.6" height="8.6" rx="1.6" />
      <path d="M2.2 7.2h11.6" />
      <circle cx="11.2" cy="9.6" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

const MARKET_STARTERS: { kind: "stock" | "fund" | "bond" | "wallet" | "live"; label: MessageKey; hint: MessageKey; text: MessageKey }[] = [
  { kind: "stock", label: "market.stock", hint: "market.stockHint", text: "market.stockText" },
  { kind: "fund", label: "market.fund", hint: "market.fundHint", text: "market.fundText" },
  { kind: "bond", label: "market.bond", hint: "market.bondHint", text: "market.bondText" },
  { kind: "live", label: "market.live", hint: "market.liveHint", text: "market.liveText" },
  { kind: "wallet", label: "market.wallet", hint: "market.walletHint", text: "market.walletText" },
];

export function WatchBoard() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, SecurityQuote>>({});
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<SecurityHit[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stop = false;
    void (async () => {
      try {
        const list = await listWatch();
        if (stop) return;
        setItems(list);
        const next: Record<string, SecurityQuote> = {};
        await Promise.all(list.map(async (item) => {
          try {
            next[item.secid] = await quoteSecurity(item.secid);
          } catch {
            /* keep the last price */
          }
        }));
        if (!stop) setQuotes((prev) => ({ ...prev, ...next }));
      } catch {
        /* the board stays as it was */
      }
    })();
    return () => {
      stop = true;
    };
  }, [tick]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 20000);
    return () => window.clearInterval(timer);
  }, []);

  async function addHit(hit: SecurityHit) {
    setBusy(true);
    setNotice("");
    try {
      await addWatch(undefined, hit.secid);
      setQuery("");
      setChoices([]);
      setTick((value) => value + 1);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function addQuery() {
    const trimmed = query.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNotice("");
    try {
      const found = await searchSecurities(trimmed);
      const exact = found.items.find((item) => item.code.toLowerCase() === trimmed.toLowerCase());
      if (exact || found.items.length === 1) {
        const hit = exact ?? found.items[0];
        await addWatch(undefined, hit.secid);
        setQuery("");
        setChoices([]);
        setTick((value) => value + 1);
        return;
      }
      setChoices(found.items.slice(0, 6));
      if (found.items.length === 0) setNotice(t("watch.none"));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function drop(secid: string) {
    try {
      await removeWatch(secid);
      setTick((value) => value + 1);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <section className="watch">
      <form
        className="watch-head"
        onSubmit={(event) => {
          event.preventDefault();
          void addQuery();
        }}
      >
        <strong>{t("watch.title")}</strong>
        <input
          value={query}
          placeholder={t("watch.placeholder")}
          aria-label={t("watch.placeholder")}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" disabled={busy || !query.trim()}>{t("watch.add")}</button>
      </form>
      <p className="watch-hint">{notice || t("watch.hint")}</p>
      {choices.length > 0 ? (
        <div className="watch-choices">
          {choices.map((hit) => (
            <button key={hit.secid} type="button" disabled={busy} onClick={() => void addHit(hit)}>
              {hit.name} {hit.code}
            </button>
          ))}
        </div>
      ) : null}
      {items.length === 0 ? <p className="watch-empty">{t("watch.empty")}</p> : (
        <div className="watch-rows">
          {items.map((item) => {
            const quote = quotes[item.secid];
            const tone = !quote ? "" : quote.changePct > 0 ? "up" : quote.changePct < 0 ? "down" : "";
            const pct = quote ? `${quote.changePct > 0 ? "+" : ""}${quote.changePct.toFixed(2)}%` : "";
            return (
              <div key={item.secid} className="watch-row">
                <span className="name">{item.name}<small>{item.code}</small></span>
                <span className={tone}>{quote ? quote.price.toFixed(2) : "—"}</span>
                <span className={tone}>{pct}</span>
                <button type="button" aria-label={t("watch.remove")} onClick={() => void drop(item.secid)}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Sidebar(props: {
  sessions: Session[];
  repos: string[];
  activeId: string;
  disabled: boolean;
  canBack: boolean;
  canForward: boolean;
  customizeActive: boolean;
  onBack: () => void;
  onForward: () => void;
  onCustomize: () => void;
  onSelect: (id: string) => void;
  onNew: (workspace: string | null, listed?: boolean, place?: "work" | "market" | "chat") => void;
  onDelete: (id: string) => void;
  onAddRepo: (title?: string) => void;
  onUseRepo: (path: string) => void;
  onForgetRepo: (path: string) => void;
  userName: string;
  onRename: (name: string) => void;
  onToggle: () => void;
  onPrompt: (text: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [order, setOrder] = useState<"recent" | "name">("recent");
  const [show, setShow] = useState<"all" | "sent">("all");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);
  const pickerAnchor = useRef<HTMLDivElement>(null);
  const filterAnchor = useRef<HTMLDivElement>(null);
  const active = props.sessions.find((session) => session.id === props.activeId);
  const activeKey = active?.workspace ? repoKey(active.workspace) : NO_REPO;
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    setOpen((prev) => {
      if (prev.has(activeKey)) return prev;
      const next = new Set(prev);
      next.add(activeKey);
      return next;
    });
  }, [activeKey]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointer(event: MouseEvent) {
      if (!pickerAnchor.current?.contains(event.target as Node)) setPickerOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!filterOpen) return;
    function onPointer(event: MouseEvent) {
      if (!filterAnchor.current?.contains(event.target as Node)) setFilterOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  useEffect(() => {
    if (!marketOpen) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".nav-pop")) return;
      setMarketOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMarketOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [marketOpen]);

  const lane = (place: "market" | "chat") =>
    props.sessions
      .filter((session) => session.place === place && (session.messages.length > 0 || session.listed || session.id === props.activeId))
      .filter((session) => !needle || displayTitle(session).toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  const marketThreads = lane("market");
  const chatThreads = lane("chat");

  const grouped = groupRepos(props.repos, props.sessions)
    .map((group) => ({
      ...group,
      threads: group.threads.filter((session) => {
        if ((session.place ?? "work") !== "work") return false;
        const listed = session.messages.length > 0 || session.listed;
        if (!listed) return false;
        if (show === "sent" && session.messages.length === 0) return false;
        return true;
      }),
    }))
    .map((group) => {
      if (!needle) return group;
      if (group.name.toLowerCase().includes(needle)) return group;
      return { ...group, threads: group.threads.filter((session) => displayTitle(session).toLowerCase().includes(needle)) };
    })
    .filter((group) => !needle || group.name.toLowerCase().includes(needle) || group.threads.length > 0)
    .sort((a, b) => {
      if (order === "name") return a.name.localeCompare(b.name, getLocale() === "zh" ? "zh" : "en");
      return (b.threads[0]?.updatedAt ?? 0) - (a.threads[0]?.updatedAt ?? 0);
    });

  function openRepo(group: { key: string; threads: Session[] }) {
    const expanded = open.has(group.key);
    setOpen((prev) => {
      const next = new Set(prev);
      if (expanded) next.delete(group.key);
      else next.add(group.key);
      return next;
    });
    if (expanded) return;
    const newest = group.threads[0];
    if (newest && newest.id !== props.activeId) props.onSelect(newest.id);
  }

  function threadRow(session: Session) {
    return (
      <div key={session.id} className={session.id === props.activeId ? "thread active" : "thread"}>
        <button type="button" className="thread-main" onClick={() => props.onSelect(session.id)}>
          <CircleIcon />
          <span>{displayTitle(session)}</span>
        </button>
        <button
          type="button"
          className="thread-delete"
          aria-label={t("nav.delete")}
          disabled={props.disabled && session.id === props.activeId}
          onClick={() => props.onDelete(session.id)}
        >
          ×
        </button>
        <small className="thread-time">{compactTime(session.updatedAt)}</small>
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-panel">
      <div className="side-toolbar">
        <button type="button" className="icon-button sidebar-toggle" aria-label={t("nav.collapse")} onClick={props.onToggle}>
          <Mark />
        </button>
        <button type="button" className="icon-button" aria-label={t("nav.back")} disabled={!props.canBack} onClick={props.onBack}>
          <ArrowIcon direction="left" />
        </button>
        <button type="button" className="icon-button" aria-label={t("nav.forward")} disabled={!props.canForward} onClick={props.onForward}>
          <ArrowIcon direction="right" />
        </button>
      </div>
      <nav className="side-nav">
        <button type="button" className="nav-item" disabled={props.disabled} onClick={() => props.onNew(null, false, "chat")}>
          <PencilIcon />
          <span>{t("nav.new")}</span>
        </button>
        {searching ? (
          <label className="side-search">
            <SearchIcon />
            <input
              value={query}
              autoFocus
              placeholder={t("nav.searchThreads")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                setSearching(false);
                setQuery("");
              }}
            />
            <button
              type="button"
              aria-label={t("window.close")}
              onClick={() => {
                setSearching(false);
                setQuery("");
              }}
            >
              ×
            </button>
          </label>
        ) : (
          <button type="button" className="nav-item" onClick={() => setSearching(true)}>
            <SearchIcon />
            <span>{t("nav.search")}</span>
          </button>
        )}
        <button type="button" className={props.customizeActive ? "nav-item active" : "nav-item"} onClick={props.onCustomize}>
          <SlidersIcon />
          <span>{t("nav.customize")}</span>
        </button>
        <div className="nav-pop">
          <button
            type="button"
            className={marketOpen ? "nav-item active" : "nav-item"}
            aria-expanded={marketOpen}
            onClick={() => setMarketOpen((value) => !value)}
          >
            <ChartIcon />
            <span>{t("nav.market")}</span>
          </button>
          {marketOpen ? (
            <div className="market-menu" role="menu">
              {MARKET_STARTERS.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  role="menuitem"
                  disabled={props.disabled}
                  onClick={() => {
                    setMarketOpen(false);
                    props.onPrompt(t(item.text));
                  }}
                >
                  <MarketGlyph kind={item.kind} size={16} />
                  <span className="market-copy">
                    <strong>{t(item.label)}</strong>
                    <span>{t(item.hint)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </nav>
      <div className="repo-head">
        <span>{t("nav.repos")}</span>
        <div>
          <div className="repo-filter" ref={filterAnchor}>
            <button
              type="button"
              className={filterOpen ? "icon-button active" : "icon-button"}
              aria-label={t("nav.filter")}
              aria-expanded={filterOpen}
              onClick={() => {
                setPickerOpen(false);
                setFilterOpen((value) => !value);
              }}
            >
              <FilterIcon />
            </button>
            {filterOpen ? (
              <RepoFilterMenu
                order={order}
                show={show}
                onOrder={setOrder}
                onShow={setShow}
                onCollapse={() => {
                  setOpen(new Set());
                  setFilterOpen(false);
                }}
              />
            ) : null}
          </div>
          <div className="repo-picker-anchor" ref={pickerAnchor}>
            <button
              type="button"
              className="icon-button"
              aria-label={t("nav.addRepo")}
              aria-expanded={pickerOpen}
              disabled={props.disabled}
              onClick={() => {
                setFilterOpen(false);
                setPickerOpen((value) => !value);
              }}
            >
              <FolderPlusIcon />
            </button>
            {pickerOpen ? (
              <RepoPicker
                repos={props.repos}
                onUse={(path) => {
                  setPickerOpen(false);
                  props.onUseRepo(path);
                }}
                onForget={props.onForgetRepo}
                onBrowse={(title) => {
                  setPickerOpen(false);
                  props.onAddRepo(title);
                }}
                onScratch={() => {
                  setPickerOpen(false);
                  props.onNew(null);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
      <div className="repo-list">
        {marketThreads.length > 0 ? (
          <>
            <div className="lane-label">{t("lane.market")}</div>
            {marketThreads.map((session) => threadRow(session))}
          </>
        ) : null}
        {chatThreads.length > 0 ? (
          <>
            <div className="lane-label">{t("lane.chat")}</div>
            {chatThreads.map((session) => threadRow(session))}
          </>
        ) : null}
        {grouped.map((group) => {
          const expanded = needle.length > 0 || open.has(group.key);
          return (
            <div key={group.key}>
              <div className={expanded ? "repo-row is-open" : "repo-row"}>
                <button type="button" className="repo-main" onClick={() => openRepo(group)}>
                  <span className="repo-glyph">
                    {group.path ? expanded ? <FolderOpenIcon /> : <FolderIcon /> : <HomeIcon />}
                    {group.path ? (
                      <span className="repo-caret" aria-hidden="true">
                        <RepoChevron expanded={expanded} />
                      </span>
                    ) : null}
                  </span>
                  <span>{group.name}</span>
                </button>
                <button
                  type="button"
                  className="icon-button repo-add"
                  aria-label={t("nav.newThread")}
                  disabled={props.disabled}
                  onClick={() => {
                    setOpen((prev) => new Set(prev).add(group.key));
                    props.onNew(group.path, true);
                  }}
                >
                  +
                </button>
              </div>
              {expanded ? group.threads.map((session) => threadRow(session)) : null}
            </div>
          );
        })}
      </div>
      <UserDock
        name={props.userName}
        active={props.customizeActive}
        onRename={props.onRename}
        onSettings={props.onCustomize}
      />
      </div>
    </aside>
  );
}

const USER_KEY = "forge.user.v1";

export function readUserName(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { name?: unknown };
    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    return isDefaultUserName(name) ? "" : name;
  } catch {
    return "";
  }
}

export function displayUserName(value: string): string {
  return value.trim() && !isDefaultUserName(value) ? value.trim() : t("user.local");
}

export function writeUserName(value: string): void {
  const next = isDefaultUserName(value) ? "" : value.trim();
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ name: next }));
  } catch {
    // The name still shows in this session.
  }
}

function Avatar() {
  return (
    <span className="avatar" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="16" fill="#e8d3c0" />
        <path d="M6.5 28.2c1.6-5.6 5-8.4 9.5-8.4s7.9 2.8 9.5 8.4" fill="#f6ece3" />
        <circle cx="16" cy="14.4" r="6.2" fill="#f7efe6" />
        <path d="M10 13.6c.3-3.6 2.6-5.8 6-5.8 3.2 0 5.4 1.9 6 5-.9 1.1-2.3.5-3.5.1-1.4-.5-2.3-1.4-3.8-.9-1.6.5-2.7 1.7-4.7 1.6z" fill="#3d342c" />
        <circle cx="13.7" cy="14.8" r=".75" fill="#3d342c" />
        <circle cx="18.3" cy="14.8" r=".75" fill="#3d342c" />
      </svg>
    </span>
  );
}

function UserDock(props: { name: string; active: boolean; onRename: (name: string) => void; onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const shown = displayUserName(props.name);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="user-dock" ref={anchor}>
      {open ? (
        <div className="user-menu">
          <label>
            {t("user.name")}
            <input value={props.name} maxLength={24} onChange={(event) => props.onRename(event.target.value)} />
          </label>
        </div>
      ) : null}
      <button type="button" className={open ? "user-chip active" : "user-chip"} onClick={() => setOpen((value) => !value)}>
        <Avatar />
        <span className="user-name">{shown}</span>
      </button>
      <button
        type="button"
        className={props.active ? "user-settings active" : "user-settings"}
        aria-label={t("user.settings")}
        onClick={props.onSettings}
      >
        <GearIcon />
      </button>
    </div>
  );
}

function RepoPicker(props: {
  repos: string[];
  onUse: (path: string) => void;
  onForget: (path: string) => void;
  onBrowse: (title: string) => void;
  onScratch: () => void;
}) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const recents = props.repos
    .slice()
    .reverse()
    .filter((path) => !needle || path.toLowerCase().includes(needle) || repoName(path).toLowerCase().includes(needle));

  return (
    <div className="repo-picker">
      <input
        autoFocus
        value={text}
        placeholder={t("picker.search")}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="repo-picker-label">{t("picker.recent")}</div>
      <div className="repo-picker-list">
        {recents.length === 0 ? <p className="repo-picker-empty">{t("picker.empty")}</p> : null}
        {recents.map((path) => (
          <div key={repoKey(path)} className="repo-picker-row">
            <button type="button" onClick={() => props.onUse(path)}>
              <FolderIcon />
              <span>{path}</span>
            </button>
            <button type="button" className="repo-picker-x" aria-label={t("picker.forget")} onClick={() => props.onForget(path)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="repo-picker-action" onClick={() => props.onBrowse(t("picker.computerTitle"))}>
        <HomeIcon />
        <span>{t("picker.computer")}</span>
      </button>
      <button type="button" className="repo-picker-action" onClick={props.onScratch}>
        <span className="repo-picker-plus">+</span>
        <span>{t("picker.scratch")}</span>
      </button>
      <div className="repo-picker-split" />
      <button type="button" className="repo-picker-action" onClick={() => props.onBrowse(t("picker.existingTitle"))}>
        <FolderIcon />
        <span>{t("picker.existing")}</span>
      </button>
      <button type="button" className="repo-picker-action" onClick={() => props.onBrowse(t("picker.createTitle"))}>
        <FolderPlusIcon />
        <span>{t("picker.create")}</span>
      </button>
    </div>
  );
}

function RepoFilterMenu(props: {
  order: "recent" | "name";
  show: "all" | "sent";
  onOrder: (value: "recent" | "name") => void;
  onShow: (value: "all" | "sent") => void;
  onCollapse: () => void;
}) {
  const sorts = [
    { id: "recent" as const, label: t("filter.recent") },
    { id: "name" as const, label: t("filter.name") },
  ];
  const shows = [
    { id: "all" as const, label: t("filter.all") },
    { id: "sent" as const, label: t("filter.sent") },
  ];

  return (
    <div className="repo-filter-menu" role="menu">
      <div className="filter-label">{t("filter.order")}</div>
      {sorts.map((item) => (
        <button
          key={item.id}
          type="button"
          className="filter-row"
          role="menuitemradio"
          aria-checked={props.order === item.id}
          onClick={() => props.onOrder(item.id)}
        >
          <span>{item.label}</span>
          {props.order === item.id ? <CheckIcon /> : null}
        </button>
      ))}
      <div className="filter-label">{t("filter.show")}</div>
      {shows.map((item) => (
        <button
          key={item.id}
          type="button"
          className="filter-row"
          role="menuitemradio"
          aria-checked={props.show === item.id}
          onClick={() => props.onShow(item.id)}
        >
          <span>{item.label}</span>
          {props.show === item.id ? <CheckIcon /> : null}
        </button>
      ))}
      <div className="filter-rule" />
      <button type="button" className="filter-action" role="menuitem" onClick={props.onCollapse}>
        {t("filter.collapse")}
      </button>
    </div>
  );
}

function groupRepos(repos: string[], sessions: Session[]): { key: string; path: string | null; name: string; threads: Session[] }[] {
  const byKey = new Map<string, { key: string; path: string | null; name: string; threads: Session[] }>();
  const ensure = (path: string | null) => {
    const key = path ? repoKey(path) : NO_REPO;
    let group = byKey.get(key);
    if (!group) {
      group = { key, path, name: path ? repoName(path) : t("lane.none"), threads: [] };
      byKey.set(key, group);
    }
    return group;
  };
  ensure(null);
  for (const path of repos) ensure(path);
  for (const session of sessions) ensure(session.workspace).threads.push(session);
  for (const group of byKey.values()) group.threads.sort((a, b) => b.updatedAt - a.updatedAt);
  return [...byKey.values()];
}

export function Transcript(props: {
  messages: ChatMessage[];
  status: string | null;
  onRewrite: (id: string, text: string) => void;
  onRevert: (changes: FileChange[]) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  function notePosition(box: HTMLElement) {
    const next = box.scrollHeight - box.scrollTop - box.clientHeight > 48;
    setAway((current) => (current === next ? current : next));
  }

  function layout() {
    const box = boxRef.current;
    if (!box) return;
    if (stick.current) box.scrollTop = box.scrollHeight;
    notePosition(box);
  }

  function jumpToEnd() {
    const box = boxRef.current;
    if (!box) return;
    stick.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: box.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    setAway(false);
  }

  useLayoutEffect(() => {
    const last = props.messages[props.messages.length - 1];
    if (last?.role === "user") stick.current = true;
    layout();
    const frame = requestAnimationFrame(layout);
    return () => cancelAnimationFrame(frame);
  }, [props.messages, props.status]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const content = box.querySelector(".messages");
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    });
    if (content) observer.observe(content);
    observer.observe(box);
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) stick.current = false;
      else requestAnimationFrame(() => {
        const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
        if (gap < 48) stick.current = true;
      });
    };
    const onScroll = () => notePosition(box);
    box.addEventListener("wheel", onWheel, { passive: true });
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("scroll", onScroll);
    };
  }, [props.messages.length > 0]);

  return (
    <div className="transcript-frame">
      <div className="transcript" ref={boxRef}>
        {props.messages.length === 0 && !props.status ? null : (
          <>
            <div className="transcript-fill" aria-hidden="true" />
            <MessageList
              messages={props.messages}
              status={props.status}
              onRewrite={props.onRewrite}
              onRevert={props.onRevert}
            />
          </>
        )}
      </div>
      {away ? (
        <button type="button" className="jump-end" aria-label={t("turn.latest")} onClick={jumpToEnd}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export function ApprovalCard(props: {
  request: ApprovalRequest;
  onDecide: (allowed: boolean, always?: boolean) => void;
}) {
  const { request } = props;
  return (
    <section className="approval">
      <header>
        <div>
          <strong>{request.title}</strong>
          <span>{request.subtitle}</span>
        </div>
        <div className="approval-actions">
          <button type="button" className="ghost" onClick={() => props.onDecide(false)}>
            {t("approval.deny")}
          </button>
          <button type="button" className="solid" onClick={() => props.onDecide(true)}>
            {t("approval.once")}
          </button>
          {request.allowKey ? (
            <button type="button" className="ghost" onClick={() => props.onDecide(true, true)}>
              {t("approval.always")}
            </button>
          ) : null}
        </div>
      </header>
      {request.command ? <pre className="command-block">{request.command}</pre> : null}
      {request.before !== undefined ? (
        <pre className="diff-old">{request.before || t("approval.empty")}</pre>
      ) : null}
      {request.after !== undefined ? (
        <pre className="diff-new">{clipPreview(request.after) || t("approval.empty")}</pre>
      ) : null}
    </section>
  );
}

function ProjectButton(props: { hint: string; label: string; caret?: boolean; onClick: () => void }) {
  return (
    <span className="hint-anchor">
      <button type="button" className={props.hint ? "meta-button hint" : "meta-button"} onClick={props.onClick}>
        <FolderIcon />
        <span>{props.label}</span>
        {props.caret ? <CaretIcon /> : null}
      </button>
      {props.hint ? <span className="hint-bubble" role="status">{props.hint}</span> : null}
    </span>
  );
}

export function Composer(props: {
  value: string;
  running: boolean;
  placeholder: string;
  projectName: string | null;
  permissionMode: PermissionMode;
  provider: string;
  model: string;
  onPickProject: () => void;
  onMode: (mode: PermissionMode) => void;
  onModel: (choice: ModelChoice) => void;
  files: string[];
  images: ChatImage[];
  hint: string;
  focusToken: number;
  onAddFiles: () => void;
  onPasteImages: (files: File[]) => void;
  onRemoveFile: (file: string) => void;
  onRemoveImage: (id: string) => void;
  onChange: (value: string) => void;
  seesImages: boolean;
  blank: boolean;
  surface: "chat" | "market" | "work";
  onSuggest: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.focusToken === 0) return;
    ref.current?.focus();
  }, [props.focusToken]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [props.value]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!props.running) props.onSend();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images: File[] = [];
    for (const item of event.clipboardData.items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length === 0) return;
    event.preventDefault();
    props.onPasteImages(images);
  }

  return (
    <div className="composer">
      {props.blank && props.surface === "market" ? (
        <div className="suggestions">
          {MARKET_STARTERS.map((item) => (
            <button key={item.kind} type="button" disabled={props.running} onClick={() => props.onSuggest(t(item.text))}>
              <MarketGlyph kind={item.kind} />
              {t(item.label)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="composer-box">
        {props.blank && props.surface === "work" ? (
          <div className="composer-context">
            <ProjectButton
              hint={props.hint}
              label={props.projectName ?? t("composer.project")}
              caret
              onClick={props.onPickProject}
            />
            <span className="meta-static">
              <MonitorIcon />
              {t("composer.local")}
            </span>
          </div>
        ) : null}
        {props.files.length > 0 || props.images.length > 0 ? (
          <div className="composer-files">
            {props.images.map((image) => (
              <span key={image.id} className="file-chip" title={image.name}>
                <img src={image.dataUrl} alt="" />
                <span>{image.name || t("composer.image")}</span>
                <button type="button" aria-label={t("composer.removeImage")} onClick={() => props.onRemoveImage(image.id)}>
                  ×
                </button>
              </span>
            ))}
            {props.files.map((file) => (
              <span key={file} className="file-chip" title={file}>
                <FileIcon />
                <span>{file.split(/[/\\]/).pop()}</span>
                <button type="button" aria-label={t("composer.removeFile")} onClick={() => props.onRemoveFile(file)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ref}
          value={props.value}
          spellCheck={false}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {props.images.length > 0 && !props.seesImages ? (
          <p className="vision-note">{t("composer.vision")}</p>
        ) : null}
        <div className="composer-bar">
          <button type="button" className="meta-button" aria-label={t("composer.addFiles")} disabled={props.running} onClick={props.onAddFiles}>
            <PaperclipIcon />
            <span>{t("composer.files")}</span>
          </button>
          {props.blank || props.surface !== "work" ? null : (
            <ProjectButton
              hint={props.hint}
              label={props.projectName ?? t("composer.project")}
              onClick={props.onPickProject}
            />
          )}
          {props.blank || props.surface !== "work" ? null : (
            <span className="meta-static">
              <MonitorIcon />
              {t("composer.local")}
            </span>
          )}
          {props.surface === "work" ? (
            <ChoiceMenu
              label={t("composer.permission")}
              value={props.permissionMode}
              options={permissionModes()}
              placement="up"
              onChange={(id) => props.onMode(id as PermissionMode)}
            />
          ) : null}
          <ModelMenu provider={props.provider} model={props.model} onPick={props.onModel} />
          {props.running ? (
            <button type="button" className="send stop" onClick={props.onStop} aria-label={t("composer.stop")}>
              ■
            </button>
          ) : (
            <button
              type="button"
              className="send"
              disabled={!props.value.trim() && props.files.length === 0 && props.images.length === 0}
              onClick={props.onSend}
              aria-label={t("composer.send")}
            >
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelMenu(props: { provider: string; model: string; onPick: (choice: ModelChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  const choices = modelChoices();
  const needle = text.trim().toLowerCase();
  const visible = choices.filter((item) => {
    if (!needle) return true;
    return (
      item.label.toLowerCase().includes(needle) ||
      item.providerLabel.toLowerCase().includes(needle) ||
      item.id.toLowerCase().includes(needle)
    );
  });
  const current =
    choices.find((item) => item.provider === props.provider && item.id === props.model) ??
    choices.find((item) => item.id === props.model);
  const duplicated = new Set(
    choices.filter((item, _, all) => all.filter((other) => other.label === item.label).length > 1).map((item) => item.label),
  );

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="model-picker" ref={anchor}>
      <button type="button" className="model-trigger" aria-label={t("composer.model")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>{current?.label ?? props.model}</span>
        <CaretIcon />
      </button>
      {open ? (
        <div className="model-menu" role="listbox" aria-label={t("composer.model")}>
          <input
            autoFocus
            value={text}
            placeholder={t("composer.searchModels")}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="model-menu-list">
            {visible.length === 0 ? <p className="model-menu-empty">{t("composer.noModels")}</p> : null}
            {visible.map((item) => {
              const selected = item.provider === props.provider && item.id === props.model;
              const name = duplicated.has(item.label) ? `${item.label} · ${item.providerLabel}` : item.label;
              return (
                <button
                  key={`${item.provider}:${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "active" : ""}
                  onClick={() => {
                    setOpen(false);
                    setText("");
                    props.onPick(item);
                  }}
                >
                  <span>{name}</span>
                  {selected ? <CheckIcon /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChoiceMenu(props: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  placement?: "up" | "down";
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 0, maxHeight: 320 });
  const anchor = useRef<HTMLDivElement>(null);
  const current = props.options.find((item) => item.id === props.value);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !(target instanceof Element && target.closest(".choice-menu"))) {
        setOpen(false);
      }
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) {
      const up = props.placement === "up";
      const available = up ? rect.top - 16 : window.innerHeight - rect.bottom - 16;
      setPlace({
        top: up ? rect.top - 6 : rect.bottom + 6,
        left: rect.right,
        maxHeight: Math.max(160, Math.min(360, available)),
      });
    }
    setOpen((value) => !value);
  }

  return (
    <div className="choice" ref={anchor}>
      <button type="button" className="choice-trigger" aria-label={props.label} aria-expanded={open} onClick={toggle}>
        <span>{current?.label ?? props.value}</span>
        <CaretIcon />
      </button>
      {open ? (
        <div
          className={props.placement === "up" ? "choice-menu up" : "choice-menu"}
          role="listbox"
          aria-label={props.label}
          style={{ top: place.top, left: place.left, maxHeight: place.maxHeight }}
        >
          {props.options.map((item) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === props.value}
              className={item.id === props.value ? "active" : ""}
              onClick={() => {
                setOpen(false);
                props.onChange(item.id);
              }}
            >
              <span>{item.label}</span>
              {item.id === props.value ? <CheckIcon /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RepoChevron(props: { expanded: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {props.expanded ? (
        <path d="M4 6.2 8 10.2 12 6.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6.2 4 10.2 8 6.2 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.2 6 7.8l3.5-3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 7.2 5.4 10 11.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SETTINGS_PAGE_IDS = ["general", "profile", "models", "broker", "skills"] as const;

type SettingsPageId = (typeof SETTINGS_PAGE_IDS)[number];

function settingsPages(): { id: SettingsPageId; label: string; keywords: string }[] {
  return [
    { id: "general", label: t("settings.general"), keywords: "通用 权限 语言 language general permission" },
    { id: "profile", label: t("settings.profile"), keywords: "资料 名称 profile name user" },
    { id: "models", label: t("settings.models"), keywords: "模型 服务商 接口 provider model api key" },
    { id: "broker", label: t("settings.broker"), keywords: "券商 实盘 qmt broker openapi 交易" },
    { id: "skills", label: t("settings.skills"), keywords: "技能 skill skills" },
  ];
}

export function SettingsPage(props: {
  draft: SettingsDraft;
  hasApiKey: boolean;
  testing: boolean;
  testMessage: string;
  userName: string;
  onRename: (name: string) => void;
  onChange: (draft: SettingsDraft) => void;
  onMode: (mode: PermissionMode) => void;
  workspace: string | null;
  onClose: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const [page, setPage] = useState<SettingsPageId>("general");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const pages = settingsPages().filter((item) => {
    if (!needle) return true;
    return item.label.toLowerCase().includes(needle) || item.keywords.toLowerCase().includes(needle);
  });

  useEffect(() => {
    if (pages.length > 0 && !pages.some((item) => item.id === page)) setPage(pages[0].id);
  }, [needle, page, pages]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  function applyPreset(id: string) {
    const preset = PROVIDERS.find((item) => item.id === id);
    if (!preset) return;
    const keepCurrent = preset.models.some((item) => item.id === props.draft.model);
    props.onChange({
      ...props.draft,
      provider: preset.id,
      baseUrl: preset.baseUrl,
      model: keepCurrent ? props.draft.model : preset.models[0].id,
    });
  }

  const models = modelOptions(props.draft.provider, props.draft.model);
  const preset = PROVIDERS.find((item) => item.id === props.draft.provider);
  const providerLabel = preset ? shownProviderLabel(preset.id, preset.label) : props.draft.provider;
  const shownName = displayUserName(props.userName);

  return (
    <div className="settings">
      <aside className="settings-nav">
        <button type="button" className="settings-back" onClick={props.onClose}>
          <ArrowIcon direction="left" />
          <span>{t("settings.back")}</span>
        </button>
        <input
          className="settings-search"
          value={query}
          placeholder={t("settings.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav>
          {pages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === page ? "active" : ""}
              onClick={() => setPage(item.id)}
            >
              {item.id === "general" ? <SlidersIcon /> : null}
              {item.id === "profile" ? <PersonIcon /> : null}
              {item.id === "models" ? <BoxIcon /> : null}
              {item.id === "broker" ? <BrokerIcon /> : null}
              {item.id === "skills" ? <SkillIcon /> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-user">
          <Avatar />
          <span>{shownName}</span>
        </div>
      </aside>
      <main className="settings-main">
        {page === "general" ? (
          <>
            <h1>{t("settings.general")}</h1>
            <section className="settings-group">
              <h2>{t("settings.language")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.languageTitle")}</strong>
                    <p>{t("settings.languageHint")}</p>
                  </div>
                  <ChoiceMenu
                    label={t("settings.language")}
                    value={getLocale()}
                    options={[
                      { id: "zh", label: "简体中文" },
                      { id: "en", label: "English" },
                    ]}
                    onChange={(id) => setLocale(id === "en" ? "en" : "zh")}
                  />
                </div>
              </div>
            </section>
            <section className="settings-group">
              <h2>{t("settings.permissions")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.permissionTitle")}</strong>
                    <p>{t("settings.permissionHint")}</p>
                  </div>
                  <ChoiceMenu
                    label={t("settings.permissionMode")}
                    value={props.draft.permissionMode}
                    options={permissionModes()}
                    onChange={(id) => props.onMode(id as PermissionMode)}
                  />
                </div>
              </div>
            </section>
          </>
        ) : null}
        {page === "profile" ? (
          <>
            <h1>{t("settings.profile")}</h1>
            <section className="settings-group">
              <h2>{t("settings.localUser")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.displayName")}</strong>
                    <p>{t("settings.displayHint")}</p>
                  </div>
                  <input
                    value={props.userName}
                    maxLength={24}
                    placeholder={t("user.local")}
                    aria-label={t("settings.displayName")}
                    onChange={(event) => props.onRename(event.target.value)}
                  />
                </div>
              </div>
            </section>
          </>
        ) : null}
        {page === "models" ? (
          <>
            <h1>{t("settings.models")}</h1>
            <section className="settings-group">
              <h2>{t("settings.connection")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.provider")}</strong>
                    <p>{t("settings.providerHint", { name: providerLabel })}</p>
                  </div>
                  <ChoiceMenu
                    label={t("settings.provider")}
                    value={props.draft.provider}
                    options={PROVIDERS.map((item) => ({ id: item.id, label: shownProviderLabel(item.id, item.label) }))}
                    onChange={applyPreset}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.baseUrl")}</strong>
                    <p>{t("settings.baseHint")}</p>
                  </div>
                  <input
                    value={props.draft.baseUrl}
                    spellCheck={false}
                    aria-label={t("settings.baseUrl")}
                    onChange={(event) => props.onChange({ ...props.draft, baseUrl: event.target.value })}
                  />
                </div>
                <div className="settings-row">
                  <div>
                    <strong>API Key</strong>
                    <p>{props.hasApiKey ? t("settings.keySaved") : t("settings.keyMissing")}</p>
                  </div>
                  <input
                    type="password"
                    value={props.draft.apiKey}
                    placeholder={props.hasApiKey ? t("settings.keyKeep") : t("settings.keyPaste")}
                    spellCheck={false}
                    aria-label="API Key"
                    onChange={(event) => props.onChange({ ...props.draft, apiKey: event.target.value })}
                  />
                </div>
              </div>
            </section>
            <section className="settings-group">
              <h2>{t("settings.defaultModel")}</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>{t("settings.model")}</strong>
                    <p>{t("settings.modelHint")}</p>
                  </div>
                  <ChoiceMenu
                    label={t("settings.model")}
                    value={props.draft.model}
                    options={models}
                    onChange={(id) => props.onChange({ ...props.draft, model: id })}
                  />
                </div>
              </div>
              {props.testMessage ? <p className="test-message settings-note">{props.testMessage}</p> : null}
              <div className="settings-actions">
                <button type="button" className="ghost" onClick={props.onTest} disabled={props.testing}>
                  {props.testing ? t("settings.testing") : t("settings.test")}
                </button>
                <button type="button" className="solid" onClick={props.onSave} disabled={props.testing}>
                  {t("settings.save")}
                </button>
              </div>
            </section>
          </>
        ) : null}
        {page === "broker" ? <BrokerSettings /> : null}
        {page === "skills" ? <SkillSettings workspace={props.workspace} /> : null}
      </main>
    </div>
  );
}

const BROKER_KINDS: BrokerKind[] = ["none", "qmt", "openapi", "client"];

function brokerKind(value: string): BrokerKind {
  return BROKER_KINDS.find((item) => item === value) ?? "none";
}

function BrokerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.5h12M4 12.5V7.2M8 12.5V4.8M12 12.5V7.2M2.8 7.2 8 3.2l5.2 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BrokerSettings() {
  const empty: BrokerDraft = { kind: "none", account: "", qmtPath: "", pythonPath: "", commandPath: "", secret: "" };
  const [draft, setDraft] = useState<BrokerDraft>(empty);
  const [hasSecret, setHasSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    getBroker()
      .then((saved) => {
        if (!alive) return;
        setDraft({
          kind: brokerKind(saved.kind),
          account: saved.account,
          qmtPath: saved.qmtPath,
          pythonPath: saved.pythonPath,
          commandPath: saved.commandPath,
          secret: "",
        });
        setHasSecret(saved.hasSecret);
      })
      .catch((reason) => {
        if (alive) setMessage(errorText(reason));
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save(test: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveBroker(draft);
      setDraft({
        kind: brokerKind(saved.kind),
        account: saved.account,
        qmtPath: saved.qmtPath,
        pythonPath: saved.pythonPath,
        commandPath: saved.commandPath,
        secret: "",
      });
      setHasSecret(saved.hasSecret);
      if (!test) {
        setMessage(t("settings.saved"));
        return;
      }
      const status = await brokerStatus();
      setMessage(status.connected ? t("broker.connected") : errorText(status.message || t("broker.disconnected")));
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  const kindLabel: Record<BrokerKind, MessageKey> = {
    none: "settings.brokerNone",
    qmt: "settings.brokerQmt",
    openapi: "settings.brokerOpenApi",
    client: "settings.brokerClient",
  };

  return (
    <>
      <h1>{t("settings.broker")}</h1>
      <section className="settings-group">
        <h2>{t("settings.brokerTitle")}</h2>
        <p className="settings-note">{t("settings.brokerHint")}</p>
        <div className="settings-card broker-card">
          <div className="settings-row">
            <div>
              <strong>{t("settings.brokerKind")}</strong>
            </div>
            <ChoiceMenu
              label={t("settings.brokerKind")}
              value={draft.kind}
              options={BROKER_KINDS.map((id) => ({ id, label: t(kindLabel[id]) }))}
              onChange={(id) => setDraft({ ...draft, kind: brokerKind(id) })}
            />
          </div>
          {draft.kind === "none" ? null : (
            <div className="settings-row">
              <div>
                <strong>{t("settings.brokerAccount")}</strong>
                <p>{t("settings.brokerAccountHint")}</p>
              </div>
              <input
                value={draft.account}
                spellCheck={false}
                aria-label={t("settings.brokerAccount")}
                onChange={(event) => setDraft({ ...draft, account: event.target.value })}
              />
            </div>
          )}
          {draft.kind === "qmt" ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.brokerQmtPath")}</strong>
                  <p>{t("settings.brokerQmtPathHint")}</p>
                </div>
                <input
                  className="path"
                  value={draft.qmtPath}
                  spellCheck={false}
                  aria-label={t("settings.brokerQmtPath")}
                  onChange={(event) => setDraft({ ...draft, qmtPath: event.target.value })}
                />
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.brokerPython")}</strong>
                  <p>{t("settings.brokerPythonHint")}</p>
                </div>
                <input
                  className="path"
                  value={draft.pythonPath}
                  spellCheck={false}
                  placeholder="python.exe"
                  aria-label={t("settings.brokerPython")}
                  onChange={(event) => setDraft({ ...draft, pythonPath: event.target.value })}
                />
              </div>
            </>
          ) : null}
          {draft.kind === "openapi" || draft.kind === "client" ? (
            <>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.brokerCommand")}</strong>
                  <p>{draft.kind === "client" ? t("settings.brokerClientHint") : t("settings.brokerOpenApiHint")}</p>
                </div>
                <input
                  className="path"
                  value={draft.commandPath}
                  spellCheck={false}
                  aria-label={t("settings.brokerCommand")}
                  onChange={(event) => setDraft({ ...draft, commandPath: event.target.value })}
                />
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.brokerSecret")}</strong>
                  <p>{hasSecret ? t("settings.brokerSecretSaved") : t("settings.brokerSecretMissing")}</p>
                </div>
                <input
                  type="password"
                  value={draft.secret}
                  spellCheck={false}
                  placeholder={hasSecret ? t("settings.keyKeep") : t("settings.keyPaste")}
                  aria-label={t("settings.brokerSecret")}
                  onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
                />
              </div>
            </>
          ) : null}
        </div>
        {draft.kind === "openapi" || draft.kind === "client" ? <p className="settings-note">{t("settings.brokerProtocol")}</p> : null}
        {message ? <p className="test-message settings-note">{message}</p> : null}
        <div className="settings-actions">
          <button type="button" className="ghost" onClick={() => void save(true)} disabled={busy || draft.kind === "none"}>
            {busy ? t("settings.testing") : t("settings.test")}
          </button>
          <button type="button" className="solid" onClick={() => void save(false)} disabled={busy}>
            {t("settings.save")}
          </button>
        </div>
      </section>
    </>
  );
}

function SkillSettings(props: { workspace: string | null }) {
  const [items, setItems] = useState<SkillEntry[]>([]);
  const [form, setForm] = useState<{ folder: string; name: string; description: string; body: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function reload() {
    const listed = await listSkills(props.workspace);
    setItems(listed);
  }

  useEffect(() => {
    let alive = true;
    listSkills(props.workspace)
      .then((listed) => {
        if (alive) setItems(listed);
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorText(reason));
      });
    return () => {
      alive = false;
    };
  }, [props.workspace]);

  const personal = items.filter((item) => item.origin === "personal");
  const project = items.filter((item) => item.origin === "project");

  async function persist() {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await saveSkill(form.name, form.description, form.body, form.folder || null);
      setForm(null);
      setMessage(t("settings.skillSaved"));
      await reload();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  async function remove(folder: string) {
    setError("");
    setMessage("");
    try {
      await deleteSkill(folder);
      if (form?.folder === folder) setForm(null);
      setPendingDelete("");
      setMessage(t("settings.skillDeleted"));
      await reload();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <>
      <h1>{t("settings.skills")}</h1>
      <section className="settings-group">
        <h2>{t("settings.skillPersonal")}</h2>
        <p className="settings-note">{t("settings.skillsHint")}</p>
        {personal.length === 0 && !form ? <p className="settings-note">{t("settings.skillEmpty")}</p> : null}
        {personal.length > 0 ? (
          <div className="settings-card skill-list">
            {personal.map((item) => (
              <div className="skill-item" key={item.folder || item.name}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
                <div className="row-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setPendingDelete("");
                      setForm({ folder: item.folder, name: item.name, description: item.description, body: item.body });
                    }}
                  >
                    {t("settings.skillEdit")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      if (pendingDelete !== item.folder) {
                        setPendingDelete(item.folder);
                        return;
                      }
                      void remove(item.folder);
                    }}
                  >
                    {pendingDelete === item.folder ? t("settings.skillConfirm") : t("settings.skillDelete")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {form ? (
          <form
            className="settings-card skill-form"
            onSubmit={(event) => {
              event.preventDefault();
              void persist();
            }}
          >
            <label>
              {t("settings.skillName")}
              <input
                value={form.name}
                maxLength={64}
                spellCheck={false}
                aria-label={t("settings.skillName")}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label>
              {t("settings.skillWhen")}
              <span>{t("settings.skillWhenHint")}</span>
              <input
                value={form.description}
                maxLength={240}
                aria-label={t("settings.skillWhen")}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </label>
            <label>
              {t("settings.skillBody")}
              <span>{t("settings.skillBodyHint")}</span>
              <textarea
                value={form.body}
                maxLength={20000}
                aria-label={t("settings.skillBody")}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
              />
            </label>
            <div className="settings-actions">
              <button type="button" className="ghost" onClick={() => setForm(null)} disabled={saving}>
                {t("settings.skillCancel")}
              </button>
              <button type="submit" className="solid" disabled={saving}>
                {t("settings.skillSave")}
              </button>
            </div>
          </form>
        ) : (
          <div className="settings-actions">
            <button
              type="button"
              className="solid"
              onClick={() => {
                setPendingDelete("");
                setMessage("");
                setError("");
                setForm({ folder: "", name: "", description: "", body: "" });
              }}
            >
              {t("settings.skillAdd")}
            </button>
          </div>
        )}
        {message ? <p className="test-message settings-note">{message}</p> : null}
        {error ? <p className="test-message settings-note">{error}</p> : null}
      </section>
      {project.length > 0 ? (
        <section className="settings-group">
          <h2>{t("settings.skillProject")}</h2>
          <p className="settings-note">{t("settings.skillProjectHint")}</p>
          <div className="settings-card skill-list">
            {project.map((item) => (
              <div className="skill-item" key={`${item.folder}-${item.name}`}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function SkillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h8v11l-4-2.2-4 2.2v-11Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.2" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.4 13.2c.7-2.2 2.4-3.2 4.6-3.2s3.9 1 4.6 3.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M2.5 5v6L8 13.5 13.5 11V5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 7.5V13.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function PreviewPane(props: { file: ReadFileResult; onClose: () => void }) {
  const lines = props.file.content === "" ? [] : props.file.content.split("\n");
  return (
    <aside className="preview">
      <header>
        <div>
          <strong>{props.file.path}</strong>
          <span>
            {props.file.startLine}-{props.file.endLine} / {props.file.totalLines}
            {props.file.truncated ? t("preview.partial") : ""}
          </span>
        </div>
        <button type="button" className="icon-button" onClick={props.onClose} aria-label={t("preview.close")}>
          ×
        </button>
      </header>
      <pre>
        {lines.map((line, index) => (
          <div key={`${props.file.startLine + index}`}>{line || " "}</div>
        ))}
      </pre>
    </aside>
  );
}

export function TickerMark() {
  return (
    <svg className="window-title-icon" width="16" height="16" viewBox="0 0 32 32" aria-hidden="true" data-tauri-drag-region>
      <rect width="32" height="32" rx="7" fill="#161311" />
      <path d="M7.4 21.6H14.2V12H22.8" fill="none" stroke="#F6F1E8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.8" cy="12" r="3.15" fill="#FF4E1A" />
    </svg>
  );
}

export function Mark() {
  return (
    <svg className="mark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.6" y="2.3" width="12.8" height="11.4" rx="1.8" />
      <path d="M6 2.3v11.4" />
    </svg>
  );
}

export function WindowTitle() {
  async function act(kind: "min" | "max" | "close") {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (kind === "min") await win.minimize();
    else if (kind === "max") await win.toggleMaximize();
    else await win.close();
  }

  return (
    <header className="window-title">
      <div className="window-title-drag" data-tauri-drag-region>
        <TickerMark />
        <span data-tauri-drag-region>Ticker</span>
      </div>
      <div className="window-title-controls">
        <button type="button" aria-label={t("window.min")} onClick={() => void act("min")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button type="button" aria-label={t("window.max")} onClick={() => void act("max")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
        <button type="button" className="close" aria-label={t("window.close")} onClick={() => void act("close")}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1" /></svg>
        </button>
      </div>
    </header>
  );
}


function MessageList(props: {
  messages: ChatMessage[];
  status: string | null;
  onRewrite: (id: string, text: string) => void;
  onRevert: (changes: FileChange[]) => void;
}) {
  const rows: Array<{ type: "compact"; id: string } | { type: "turn"; user: ChatMessage | null; steps: ChatMessage[] }> = [];
  for (const message of props.messages) {
    if (message.kind === "compact") {
      rows.push({ type: "compact", id: message.id });
      continue;
    }
    if (message.role === "user") {
      rows.push({ type: "turn", user: message, steps: [] });
      continue;
    }
    const last = rows[rows.length - 1];
    if (!last || last.type !== "turn") rows.push({ type: "turn", user: null, steps: [message] });
    else last.steps.push(message);
  }
  return (
    <div className="messages">
      {rows.map((row, index) =>
        row.type === "compact" ? (
          <div key={row.id} className="compact-note">{t("turn.compact")}</div>
        ) : (
          <Turn
            key={row.user?.id ?? row.steps[0]?.id ?? index}
            user={row.user}
            steps={row.steps}
            onRewrite={props.onRewrite}
            onRevert={props.onRevert}
          />
        ),
      )}
      {props.status && waitingToWrite(props.messages) ? <p className="status-line shimmer">{props.status}</p> : null}
    </div>
  );
}

function waitingToWrite(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return !last || last.role === "user";
}

function Turn(props: {
  user: ChatMessage | null;
  steps: ChatMessage[];
  onRewrite: (id: string, text: string) => void;
  onRevert: (changes: FileChange[]) => void;
}) {
  const busy = props.steps.some((step) => step.status === "streaming" || step.status === "running");
  const hasWork = props.steps.some(
    (step) => step.role === "tool" || Boolean(step.reasoning) || (step.toolCalls?.length ?? 0) > 0,
  );
  const answerAt = hasWork ? finalAnswerIndex(props.steps) : -1;
  const answer = answerAt >= 0 ? props.steps[answerAt] : null;
  const carried = answer && replyLooksCut(answer.content) ? (answer.reasoning?.trim() ?? "") : "";
  const workSteps = answer
    ? props.steps.flatMap((step, index) => {
        if (index !== answerAt) return [step];
        if (!step.reasoning || carried) return [];
        return [{ ...step, content: "" }];
      })
    : props.steps;
  const copyText = (answer ? [answer.content, carried].filter(Boolean).join("\n\n") : props.steps.filter((step) => step.role === "assistant").map((step) => step.content).join("\n\n")).trim();
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);
  const changes = changedFiles(props.steps);
  const answerText = answer?.content.trim() ?? "";
  const liveThought = props.steps.map((step) => step.reasoning?.trim() ?? "").filter(Boolean).join("\n\n");
  const thoughtText = carried ? "" : liveThought;
  const note = activityLine(props.steps);
  const hasTools = props.steps.some((step) => step.role === "tool" || (step.toolCalls?.length ?? 0) > 0);
  const thinking = busy && !answerText;
  const showThink = Boolean(thoughtText) || thinking;
  const started = useRef<number | null>(null);
  const thoughtStarted = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [thoughtElapsed, setThoughtElapsed] = useState<number | null>(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [thinkFull, setThinkFull] = useState(false);
  const workTouched = useRef(false);
  const thinkTouched = useRef(false);
  useEffect(() => {
    if (busy && started.current === null) started.current = Date.now();
    if (!busy && started.current !== null) setElapsed((current) => current ?? Date.now() - (started.current ?? Date.now()));
  }, [busy]);
  useEffect(() => {
    if (thinking && thoughtStarted.current === null) thoughtStarted.current = Date.now();
    if (!thinking && thoughtStarted.current !== null) {
      setThoughtElapsed((current) => current ?? Date.now() - (thoughtStarted.current ?? Date.now()));
    }
  }, [thinking]);
  useEffect(() => {
    if (workTouched.current) return;
    if (answerText) setWorkOpen(false);
  }, [answerText]);
  useEffect(() => {
    if (thinkTouched.current) return;
    if (!thinking) setThinkFull(false);
  }, [thinking]);
  return (
    <div className="turn">
      {props.user ? (
        <div className="turn-pin">
          <UserMessage message={props.user} onRewrite={props.onRewrite} />
        </div>
      ) : null}
      {hasTools ? (
        <div className="work-block">
          <button
            type="button"
            className={workOpen ? "work-head open" : "work-head"}
            aria-expanded={workOpen}
            onClick={() => {
              workTouched.current = true;
              setWorkOpen((value) => !value);
            }}
          >
            <span>{workTitle(busy, elapsed)}</span>
          </button>
          {workOpen ? (
            <>
              {note ? <p className="work-note">{note}</p> : null}
              <WorkSteps steps={workSteps} hideReasoning={Boolean(thoughtText)} hideWaiting={showThink} />
            </>
          ) : null}
        </div>
      ) : null}
      {showThink ? (
        <div className="work-block">
          <button
            type="button"
            className={thinkFull || (thinking && thoughtText) ? "work-head open" : "work-head"}
            aria-expanded={thinkFull || (thinking && Boolean(thoughtText))}
            onClick={() => {
              thinkTouched.current = true;
              setThinkFull((value) => !value);
            }}
          >
            {thinking ? <ThoughtLine text={thoughtCue(props.steps)} /> : <span>{thinkTitle(thinking, thoughtElapsed)}</span>}
          </button>
          {thinkFull ? (
            thoughtText ? <p className="work-thought">{thoughtText}</p> : null
          ) : thinking && thoughtText ? (
            <ThinkingRoll text={thoughtText} />
          ) : null}
        </div>
      ) : null}
      {!hasWork && props.steps.length > 0 ? <WorkSteps steps={props.steps} hideWaiting={showThink} /> : null}
      {answer && (answer.content.trim() || carried) ? (
        <div className={answer.status === "error" ? "assistant error" : "assistant"}>
          {answer.content.trim() ? <RichText text={answer.content} /> : null}
          {carried ? <RichText text={carried} /> : null}
        </div>
      ) : null}
      {copyText ? (
        <div className="turn-actions">
          <ActionButton label={t("turn.up")} pressed={vote === "up"} onClick={() => setVote((current) => (current === "up" ? null : "up"))}>
            <ThumbIcon />
          </ActionButton>
          <ActionButton label={t("turn.down")} pressed={vote === "down"} onClick={() => setVote((current) => (current === "down" ? null : "down"))}>
            <ThumbIcon down />
          </ActionButton>
          <ActionButton
            label={copied ? t("turn.copied") : t("turn.copy")}
            onClick={() => {
              void navigator.clipboard.writeText(copyText).then(() => {
                setCopied(true);
                if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
                copiedTimer.current = window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            <CopyIcon />
          </ActionButton>
        </div>
      ) : null}
      {changes.length > 0 ? <Changes files={changes} onRevert={props.onRevert} /> : null}
    </div>
  );
}

function ActionButton(props: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={props.pressed ? "pressed" : undefined} aria-label={props.label} aria-pressed={props.pressed} onClick={props.onClick}>
      {props.children}
      <span className="action-tip" role="tooltip">{props.label}</span>
    </button>
  );
}

function UserMessage(props: { message: ChatMessage; onRewrite: (id: string, text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.message.content);
  return (
    <article className="bubble user">
      <div>
        {props.message.images?.map((image) =>
          image.dataUrl ? <img key={image.id} className="pasted" src={image.dataUrl} alt={image.name} /> : null,
        )}
        {editing ? (
          <div className="rewrite">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div>
              <button type="button" onClick={() => setEditing(false)}>
                {t("turn.cancel")}
              </button>
              <button
                type="button"
                disabled={!draft.trim()}
                onClick={() => {
                  setEditing(false);
                  props.onRewrite(props.message.id, draft.trim());
                }}
              >
                {t("turn.resend")}
              </button>
            </div>
          </div>
        ) : props.message.content ? (
          <RichText text={props.message.content} />
        ) : null}
      </div>
      {editing ? null : (
        <button
          type="button"
          className="corner-button"
          aria-label={t("turn.edit")}
          onClick={() => {
            setDraft(props.message.content);
            setEditing(true);
          }}
        >
          <CornerIcon />
        </button>
      )}
    </article>
  );
}

function finalAnswerIndex(steps: ChatMessage[]): number {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    const calls = step.toolCalls?.length ?? 0;
    if (step.role === "assistant" && calls === 0 && (step.content.trim() || step.status === "streaming")) return index;
  }
  return -1;
}

function thoughtCue(steps: ChatMessage[]): string {
  const acting = steps.some((step) => {
    if (step.role === "tool" && (step.status === "running" || step.status === "streaming")) return true;
    return step.status === "streaming" && (step.toolCalls?.length ?? 0) > 0;
  });
  return acting ? t("status.planning") : t("status.thinking");
}

function ThoughtLine(props: { text: string }) {
  const shown = useRef(props.text);
  const [items, setItems] = useState<string[]>([props.text]);
  const [roll, setRoll] = useState(0);

  useEffect(() => {
    if (props.text === shown.current) return;
    const from = shown.current;
    shown.current = props.text;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setItems([props.text]);
      return;
    }
    setItems([from, props.text]);
    setRoll((value) => value + 1);
  }, [props.text]);

  useEffect(() => {
    if (roll === 0) return;
    const timer = window.setTimeout(() => setItems([shown.current]), 340);
    return () => window.clearTimeout(timer);
  }, [roll]);

  return (
    <div className="thought-line">
      <div key={roll} className={items.length > 1 ? "thought-track rolling" : "thought-track"}>
        {items.map((item, index) => (
          <span key={`${roll}-${index}`} className="shimmer">{item}</span>
        ))}
      </div>
    </div>
  );
}

function thinkTitle(streaming: boolean, elapsed: number | null): string {
  if (streaming || elapsed === null) return t("status.thinking");
  const total = Math.max(1, Math.round(elapsed / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return t("think.seconds", { n: total });
  return t("think.minutes", { m: minutes, s: seconds });
}

function ThinkingRoll(props: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [overflow, setOverflow] = useState(false);
  const [edge, setEdge] = useState<"top" | "mid" | "bottom">("bottom");

  function place(box: HTMLElement) {
    const next = box.scrollHeight > box.clientHeight + 2;
    setOverflow((current) => (current === next ? current : next));
    if (!next) return;
    const gap = box.scrollHeight - box.scrollTop - box.clientHeight;
    const side = box.scrollTop < 8 ? "top" : gap < 8 ? "bottom" : "mid";
    setEdge((current) => (current === side ? current : side));
  }

  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (stick.current) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      box.scrollTo({ top: box.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    }
    place(box);
  }, [props.text]);

  return (
    <div
      className={overflow ? `thinking-roll overflow ${edge}` : "thinking-roll"}
      ref={ref}
      onScroll={(event) => place(event.currentTarget)}
      onWheel={(event) => {
        if (event.deltaY < 0) stick.current = false;
        const box = ref.current;
        if (!box || event.deltaY <= 0) return;
        if (box.scrollHeight - box.scrollTop - box.clientHeight < 48) stick.current = true;
      }}
    >
      <p>{props.text}</p>
    </div>
  );
}

function WorkSteps(props: { steps: ChatMessage[]; hideReasoning?: boolean; hideWaiting?: boolean }) {
  return (
    <div className="work-steps">
      {props.steps.map((step) => {
        if (step.role === "tool") return <ToolLine key={step.id} message={step} />;
        const reasoning = props.hideReasoning ? "" : (step.reasoning ?? "");
        const waiting = !props.hideWaiting && step.status === "streaming" && !step.content;
        if (!reasoning && !step.content && !waiting) return null;
        return (
          <div key={step.id} className={step.status === "error" ? "assistant error" : "assistant"}>
            {reasoning ? (
              <details className="reasoning">
                <summary>{t("turn.thinking")}</summary>
                <RichText text={reasoning} />
              </details>
            ) : null}
            {step.content ? <RichText text={step.content} /> : null}
            {waiting ? <span className="shimmer">{t("status.thinking")}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function workTitle(busy: boolean, elapsed: number | null): string {
  if (busy || elapsed === null) return busy ? t("turn.working") : t("turn.worked");
  const total = Math.max(1, Math.round(elapsed / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return t("work.seconds", { n: total });
  return t("work.minutes", { m: minutes, s: seconds });
}

function activityLine(steps: ChatMessage[]): string {
  const explored = new Set<string>();
  const quotes = new Set<string>();
  let commands = 0;
  for (const step of steps) {
    if (step.role !== "tool") continue;
    const name = step.toolName ?? "";
    if (name === "run_command") {
      commands += 1;
      continue;
    }
    if (name === "search_securities" || name === "quote_security" || name === "security_history") {
      quotes.add(step.id);
      continue;
    }
    if (name === "read_file" || name === "list_dir" || name === "grep" || name === "glob") {
      explored.add(argPath(step.args) || step.id);
    }
  }
  const parts: string[] = [];
  if (explored.size > 0) parts.push(t("work.explored", { n: explored.size }));
  if (quotes.size > 0) parts.push(t("work.quotes", { n: quotes.size }));
  if (commands > 0) parts.push(t("work.ran", { n: commands }));
  return parts.join("，");
}

function changedFiles(steps: ChatMessage[]): FileChange[] {
  const files: FileChange[] = [];
  for (const step of steps) {
    if (step.role !== "tool" || step.status === "denied" || step.status === "error" || step.status === "running") continue;
    if (step.toolName !== "edit_file" && step.toolName !== "write_file") continue;
    if (step.change) {
      files.push(step.change);
      continue;
    }
    const path = argPath(step.args);
    if (!path || files.some((item) => item.path === path)) continue;
    files.push({
      path,
      kind: step.toolName === "write_file" ? "write" : "edit",
      created: false,
      before: null,
      omitted: true,
      removed: argString(step.args, "old_string"),
      added: argString(step.args, step.toolName === "write_file" ? "content" : "new_string"),
    });
  }
  return files;
}

function ToolLine({ message }: { message: ChatMessage }) {
  const long = message.content.length > 0;
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool-line ${message.status ?? "done"}`}>
      <button type="button" onClick={() => long && setOpen((value) => !value)}>
        <span>{stepLabel(message)}</span>
        {message.status === "running" || message.status === "streaming" ? <small>{t("tool.running")}</small> : null}
        {message.status === "error" ? <small>{t("tool.failed")}</small> : null}
        {message.status === "denied" ? <small>{t("tool.denied")}</small> : null}
      </button>
      {open && message.content ? <pre>{message.content}</pre> : null}
    </div>
  );
}

function lineCount(text: string): number {
  return text.split("\n").filter((line) => line.length > 0).length;
}

function Changes(props: { files: FileChange[]; onRevert: (changes: FileChange[]) => void }) {
  const [open, setOpen] = useState(false);
  const names = [...new Set(props.files.map((file) => file.path))];
  const added = props.files.reduce((sum, file) => sum + lineCount(file.added), 0);
  const removed = props.files.reduce((sum, file) => sum + lineCount(file.removed), 0);
  const canRevert = props.files.some((file) => !file.omitted && (file.created || file.before !== null));
  return (
    <section className="changes">
      <button type="button" className={open ? "changes-line open" : "changes-line"} onClick={() => setOpen((value) => !value)}>
        <span>{t("work.edited", { n: names.length })}</span>
        {added > 0 ? <span className="stat add">+{added}</span> : null}
        {removed > 0 ? <span className="stat del">-{removed}</span> : null}
      </button>
      {open ? (
        <>
          {names.map((path) => (
            <div key={path} className="changes-row">
              <FileIcon />
              <span>{path.split(/[/\\]/).pop()}</span>
            </div>
          ))}
          {props.files.map((file, index) => (
            <div key={`${file.path}-${index}`} className="change-diff">
              <p>{file.path}</p>
              {file.removed ? <pre className="diff-old">{file.removed}</pre> : null}
              {file.added ? <pre className="diff-new">{file.added}</pre> : null}
              {file.omitted ? <small>{t("changes.tooBig")}</small> : null}
            </div>
          ))}
          <button type="button" className="changes-revert" disabled={!canRevert} onClick={() => props.onRevert(props.files)}>
            {t("changes.revert")}
          </button>
        </>
      ) : null}
    </section>
  );
}

function stepLabel(message: ChatMessage): string {
  const name = message.toolName ?? "";
  const path = fileName(argPath(message.args));
  const pattern = argString(message.args, "pattern");
  const command = argString(message.args, "command");
  if (name === "read_file") return path ? t("step.read", { name: path }) : t("step.readFile");
  if (name === "list_dir") return path ? t("step.list", { name: path }) : t("step.listDir");
  if (name === "grep") return path ? t("step.grep", { name: path }) : pattern ? t("step.grep", { name: pattern }) : t("step.grepCode");
  if (name === "glob") return pattern ? t("step.glob", { name: pattern }) : t("step.globFile");
  if (name === "edit_file") return path ? t("step.edit", { name: path }) : t("step.editFile");
  if (name === "write_file") return path ? t("step.write", { name: path }) : t("step.writeFile");
  if (name === "run_command") return command ? t("step.command", { name: command }) : t("step.commandBare");
  if (name === "search_securities") {
    const query = argString(message.args, "query");
    return query ? t("step.search", { name: query }) : t("step.searchBare");
  }
  if (name === "quote_security") return t("step.quote");
  if (name === "security_history") return t("step.history");
  if (name === "paper_account") return t("step.account");
  if (name === "paper_order") return argString(message.args, "side") === "sell" ? t("step.sell") : t("step.buy");
  if (name === "broker_status") return t("step.broker");
  if (name === "broker_account") return t("step.brokerAccount");
  if (name === "broker_order") return argString(message.args, "side") === "sell" ? t("step.liveSell") : t("step.liveBuy");
  if (name === "price_alert") {
    const action = argString(message.args, "action");
    if (action === "list") return t("step.alertList");
    if (action === "remove") return t("step.alertRemove");
    return t("step.alert");
  }
  if (name === "watch_security") {
    const action = argString(message.args, "action");
    if (action === "list") return t("step.watchList");
    if (action === "remove") return t("step.watchRemove");
    const watched = argString(message.args, "query") || argString(message.args, "secid");
    return watched ? t("step.watch", { name: watched }) : t("step.watchBare");
  }
  if (name === "read_memory") return t("step.memory");
  if (name === "remember") return t("step.remember");
  if (name === "read_skill") {
    const skill = argString(message.args, "name");
    return skill ? t("step.skill", { name: skill }) : t("step.skillBare");
  }
  return toolLabel({ id: message.toolCallId ?? "", name, arguments: message.args ?? "{}" });
}

function argPath(raw: string | undefined): string {
  return argString(raw, "path");
}

function argString(raw: string | undefined, key: string): string {
  try {
    const value = JSON.parse(raw || "{}") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "string" ? field : "";
  } catch {
    return "";
  }
}

function fileName(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function CodeBlock(props: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const label = copied ? t("turn.copied") : t("code.copy");
  return (
    <div className="code-block">
      <div className="code-bar">
        <span className="lang">{props.lang}</span>
        <button
          type="button"
          className="code-copy"
          aria-label={label}
          onClick={() => {
            void navigator.clipboard.writeText(props.text).then(() => {
              setCopied(true);
              if (timer.current !== null) window.clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          <CopyIcon />
          <span className="action-tip" role="tooltip">{label}</span>
        </button>
      </div>
      <pre><code>{highlightCode(props.text, props.lang)}</code></pre>
    </div>
  );
}

function RichText({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="prose">
      {blocks.map((block, index) => {
        if (block.kind === "code") return <CodeBlock key={index} lang={block.lang} text={block.text} />;
        if (block.kind === "h") {
          const Tag = (`h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6");
          return <Tag key={index}>{renderInline(block.text)}</Tag>;
        }
        if (block.kind === "ul" || block.kind === "ol") {
          const Tag = block.kind === "ul" ? "ul" : "ol";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.kind === "quote") return <blockquote key={index}>{renderInline(block.text)}</blockquote>;
        if (block.kind === "rule") return <hr key={index} />;
        if (block.kind === "table") {
          return (
            <div className="table-wrap" key={index}>
              <table>
                <thead>
                  <tr>
                    {block.header.map((cell, cellIndex) => (
                      <th key={cellIndex} className={cellClass(block.align[cellIndex], block.numeric[cellIndex])}>
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {block.header.map((_, cellIndex) => (
                        <td key={cellIndex} className={cellClass(block.align[cellIndex], block.numeric[cellIndex])}>
                          {renderInline(row[cellIndex] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

type MdBlock =
  | { kind: "code"; lang: string; text: string }
  | { kind: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][]; align: Array<"left" | "center" | "right">; numeric: boolean[] };

function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  for (const part of splitFences(text)) {
    if (part.kind === "code") blocks.push({ kind: "code", lang: part.lang ?? "", text: part.text });
    else blocks.push(...parseBlocks(part.text));
  }
  return blocks;
}

function parseBlocks(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "h", level, text: heading[2].replace(/\s+#+\s*$/, "").trim() });
      i += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    const table = readTable(lines, i);
    if (table) {
      blocks.push(table.block);
      i = table.next;
      continue;
    }
    if (/^[-*]\s+/.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length) {
        if (/^[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^[-*]\s+/, ""));
          i += 1;
          continue;
        }
        if (items.length > 0 && /^\s+\S/.test(lines[i]) && !blockStart(lines[i].trim())) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length) {
        if (/^\d+[.)]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\d+[.)]\s+/, ""));
          i += 1;
          continue;
        }
        if (items.length > 0 && /^\s+\S/.test(lines[i]) && !blockStart(lines[i].trim())) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    if (/^>\s?/.test(lines[i])) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: parts.join("\n") });
      continue;
    }
    const parts: string[] = [];
    const before = i;
    while (i < lines.length && lines[i].trim() && !blockStart(lines[i])) {
      parts.push(lines[i].trimEnd());
      i += 1;
    }
    if (i === before) {
      parts.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", text: parts.join("\n") });
  }
  return blocks;
}

function blockStart(line: string): boolean {
  const trimmed = line.trim();
  return /^(#{1,6})\s+\S/.test(trimmed)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)
    || /^[-*]\s+/.test(trimmed)
    || /^\d+[.)]\s+/.test(trimmed)
    || /^>\s?/.test(trimmed)
    || (/^\|/.test(trimmed) && trimmed.includes("|", 1));
}

function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  const cells = body.split("|").map((cell) => cell.trim());
  if (cells.length < 2) return null;
  return cells;
}

function isSeparator(line: string): boolean {
  const cells = splitRow(line);
  return Boolean(cells && cells.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function columnAlign(cell: string): "left" | "center" | "right" {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

function isPlainNumber(text: string): boolean {
  return /^[+-]?\d[\d,]*(?:\.\d+)?%?$/.test(text.trim());
}

function cellClass(align: "left" | "center" | "right", numeric: boolean): string | undefined {
  if (align === "center") return "center";
  if (align === "right" || numeric) return "num";
  return undefined;
}

function readTable(lines: string[], start: number): { block: Extract<MdBlock, { kind: "table" }>; next: number } | null {
  if (start + 1 >= lines.length || !isSeparator(lines[start + 1])) return null;
  const header = splitRow(lines[start]);
  const separator = splitRow(lines[start + 1]);
  if (!header || !separator) return null;
  const align = header.map((_, index) => columnAlign(separator[index] ?? ""));
  const rows: string[][] = [];
  let next = start + 2;
  while (next < lines.length && lines[next].trim()) {
    const row = splitRow(lines[next]);
    if (!row || isSeparator(lines[next]) || !lines[next].trim().startsWith("|")) break;
    rows.push(header.map((_, index) => row[index] ?? ""));
    next += 1;
  }
  if (rows.length === 0) return null;
  const numeric = header.map((_, index) => {
    const values = rows.map((row) => row[index].trim()).filter(Boolean);
    return values.length > 0 && values.every(isPlainNumber);
  });
  return { block: { kind: "table", header, rows, align, numeric }, next };
}

function renderInline(text: string): ReactNode[] {
  const pattern = /(`[^`\n]+`)|(\*\*(.+?)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|(\*([^*\n]+)\*)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));
    if (match[1]) nodes.push(<code key={key}>{match[1].slice(1, -1)}</code>);
    else if (match[3]) nodes.push(<strong key={key}>{renderInline(match[3])}</strong>);
    else if (match[5] && match[6]) {
      nodes.push(
        <a key={key} href={match[6]} target="_blank" rel="noreferrer">
          {match[5]}
        </a>,
      );
    } else if (match[8] && !/^\s|\s$/.test(match[8])) nodes.push(<em key={key}>{match[8]}</em>);
    else nodes.push(match[0]);
    key += 1;
    cursor = index + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function splitFences(text: string): { kind: "text" | "code"; text: string; lang?: string }[] {
  const parts = text.split("```");
  return parts.map((part, index) => {
    if (index % 2 === 0) return { kind: "text" as const, text: part.trim() };
    const breakAt = part.indexOf("\n");
    if (breakAt === -1) return { kind: "code" as const, text: part, lang: "" };
    return {
      kind: "code" as const,
      lang: part.slice(0, breakAt).trim(),
      text: part.slice(breakAt + 1).replace(/\n$/, ""),
    };
  }).filter((part) => part.text.length > 0);
}

function compactTime(timestamp: number): string {
  const seconds = Math.max(0, Date.now() - timestamp) / 1000;
  if (seconds < 60) return t("time.now");
  if (seconds < 3600) return t("time.minute", { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("time.hour", { n: Math.floor(seconds / 3600) });
  if (seconds < 86400 * 30) return t("time.day", { n: Math.floor(seconds / 86400) });
  return t("time.month", { n: Math.floor(seconds / (86400 * 30)) });
}

function CornerIcon() {
  return (
    <svg className="corner" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.6 2.8 13.2 6.4 5.4 14.2H1.8v-3.6L9.6 2.8Z" />
      <path d="M8.2 4.2 11.8 7.8" />
    </svg>
  );
}

function ThumbIcon(props: { down?: boolean }) {
  return (
    <svg className={props.down ? "down" : undefined} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.1 7.3h2.1V13H4.1A1.1 1.1 0 0 1 3 11.9V8.4A1.1 1.1 0 0 1 4.1 7.3Z" />
      <path d="M6.2 7.5 8.2 3.2a1.15 1.15 0 0 1 2.1.6v2.6h2.5a1.25 1.25 0 0 1 1.2 1.5l-.7 4.3a1.25 1.25 0 0 1-1.2 1H6.2V7.5Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5.2" y="5.2" width="7.2" height="7.2" rx="1.2" />
      <path d="M10.8 5.2V3.8A1.2 1.2 0 0 0 9.6 2.6H3.8A1.2 1.2 0 0 0 2.6 3.8v5.8a1.2 1.2 0 0 0 1.2 1.2h1.4" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 12.8V4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M3.5 8.1 8 3.4l4.5 4.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.6 4.2 6.1 8.7a2.1 2.1 0 0 0 3 3l4.6-4.6a3.2 3.2 0 0 0-4.5-4.5L4.4 7.4a4.2 4.2 0 0 0 6 6l3.2-3.2" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.2 1.8h4.4L12.2 5.4v8.8H4.2V1.8Z" />
      <path d="M8.5 1.8V5.5h3.7" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.2" y="2.4" width="11.6" height="8" rx="1.2" />
      <path d="M6 13.2h4M8 10.4v2.8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.6l1.2 1.3H12.8A1.2 1.2 0 0 1 14 5.5v6.3a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V4.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.7 12.6V3.3c0-.7.55-1.25 1.25-1.25H5.1l1.05 1.2h5.9c.7 0 1.25.55 1.25 1.25v7.85c0 .7-.55 1.25-1.25 1.25H2.95c-.7 0-1.25-.55-1.25-1.25Z" />
      <path d="M4.35 7.15H12.7M4.35 7.15v4.55" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4.2A1.2 1.2 0 0 1 3.2 3h2.4l1.1 1.2H11" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2.4 6.2h8.2A1.2 1.2 0 0 1 11.8 7.4v4.4a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.8V6.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M13 3.2v3.2M11.4 4.8h3.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 7.2 8 3.2l5 4v5.3a.8.8 0 0 1-.8.8H9.2V9.6H6.8v3.7H3.8a.8.8 0 0 1-.8-.8V7.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon(props: { direction: "left" | "right" }) {
  const points = props.direction === "left" ? "M10 3.5 5.5 8 10 12.5" : "M6 3.5 10.5 8 6 12.5";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d={points} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M9.2 3.2 12.8 6.8 6 13.6H2.4V10L9.2 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.2 4.2 11.8 7.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 12.5 6 8.2l2.2 2.1L13.5 4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.2 4H13.5V7.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.2 10.2 13.2 13.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M3 8h10M3 11.5h10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.3" fill="var(--sidebar)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10" cy="8" r="1.3" fill="var(--sidebar)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="11.5" r="1.3" fill="var(--sidebar)" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h10M5 8h6M7 11.5h2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function clipPreview(text: string): string {
  const lines = text.split("\n").slice(0, 80);
  return lines.join("\n");
}
