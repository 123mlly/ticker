import { isMarketStarter, t } from "./i18n";
import type { ChatMessage, Session } from "./types";

const KEY = "forge.sessions.v1";
const REPOS_KEY = "forge.repos.v1";

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [createSession(null)];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [createSession(null)];
    return parsed.map((session) => {
      const place = session.place === "market" || session.place === "chat" ? session.place : "work";
      const market = place === "work" && isMarketThread(session);
      return {
        ...session,
        workspace: market ? null : typeof session.workspace === "string" ? session.workspace : null,
        place: market ? "market" : place,
        listed: session.listed === true,
      };
    });
  } catch {
    return [createSession(null)];
  }
}

export function loadRepos(): string[] {
  try {
    const raw = localStorage.getItem(REPOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export function saveRepos(repos: string[]): void {
  try {
    localStorage.setItem(REPOS_KEY, JSON.stringify(repos.slice(0, 40)));
  } catch {
    // The list still exists in memory.
  }
}

export function repoKey(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

export function repoName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function mergeRepos(current: string[], extra: Array<string | null | undefined>): string[] {
  const next = current.slice();
  for (const path of extra) {
    if (!path) continue;
    if (next.some((item) => repoKey(item) === repoKey(path))) continue;
    next.push(path);
  }
  return next;
}

export function saveSessions(sessions: Session[]): void {
  const compact = sessions.slice(0, 40).map((session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.role === "tool" && message.content.length > 20_000) {
        return {
          ...message,
          content: `${message.content.slice(0, 20_000)}\n${t("fmt.sessionCut")}`,
          status: message.status === "streaming" ? "done" : message.status,
        };
      }
      if (message.status === "streaming" || message.status === "running") {
        return { ...message, status: "done" as const };
      }
      return message;
    }),
  }));
  try {
    localStorage.setItem(KEY, JSON.stringify(compact));
  } catch {
    try {
      const lighter = compact.map((session) => ({
        ...session,
        messages: session.messages.map((message) => ({
          ...message,
          images: message.images?.map((image) => ({ ...image, dataUrl: "" })),
          change: message.change ? { ...message.change, before: null, omitted: true } : undefined,
        })),
      }));
      localStorage.setItem(KEY, JSON.stringify(lighter));
    } catch {
      // The browser refused the write. The conversation still exists in memory.
    }
  }
}

export function createSession(
  workspace: string | null,
  listed = false,
  place: "work" | "market" | "chat" = "work",
): Session {
  const now = Date.now();
  return {
    id: uid(),
    title: place === "market" ? t("title.market") : place === "chat" ? t("title.chat") : listed ? t("title.agent") : t("title.thread"),
    workspace: place === "work" ? workspace : null,
    place,
    messages: [],
    createdAt: now,
    updatedAt: now,
    listed,
  };
}

function isMarketThread(session: Session): boolean {
  const first = session.messages.find((message) => message.role === "user")?.content ?? "";
  return isMarketStarter(first);
}

const PLACEHOLDER_TITLES = new Set([
  "新对话",
  "新线程",
  "新代理",
  "新智能体",
  "新炒股",
  "New chat",
  "New thread",
  "New agent",
  "New market",
]);

export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER_TITLES.has(title);
}

export function displayTitle(session: Session): string {
  const title = session.title;
  if (title === "新炒股" || title === "New market" || (session.place === "market" && isPlaceholderTitle(title))) {
    return t("title.market");
  }
  if (title === "新智能体" || title === "新代理" || title === "New agent") return t("title.agent");
  if (title === "新对话" || title === "New chat") return t("title.chat");
  if (title === "新线程" || title === "New thread") return t("title.thread");
  return title;
}

export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  if (!first) return t("title.thread");
  const text = first.content.replace(/\s+/g, " ").trim();
  if (!text) return t("title.thread");
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
}

export function uid(): string {
  counter += 1;
  return `m${Date.now().toString(36)}${counter.toString(36)}`;
}

let counter = 0;
