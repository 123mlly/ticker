import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
import type {
  CommandOutput,
  CompletionResult,
  DirEntry,
  EditFileResult,
  GlobResult,
  GrepResult,
  BrokerAccount,
  BrokerDraft,
  BrokerOrderResult,
  BrokerStatus,
  PaperAccount,
  PaperOrderResult,
  PriceAlert,
  PublicBroker,
  PublicSettings,
  ReadFileResult,
  SecurityHistory,
  SecurityQuote,
  SecuritySearch,
  WatchItem,
  SettingsDraft,
  StreamEvent,
  WriteFileResult,
} from "./types";

export function inDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getSettings(): Promise<PublicSettings> {
  return invoke<PublicSettings>("get_settings");
}

export function saveSettings(draft: SettingsDraft): Promise<PublicSettings> {
  return invoke<PublicSettings>("save_settings", { patch: draft });
}

export function getBroker(): Promise<PublicBroker> {
  return invoke<PublicBroker>("get_broker");
}

export function saveBroker(draft: BrokerDraft): Promise<PublicBroker> {
  return invoke<PublicBroker>("save_broker", { patch: draft });
}

export function brokerStatus(): Promise<BrokerStatus> {
  return invoke<BrokerStatus>("broker_status");
}

export function brokerAccount(): Promise<BrokerAccount> {
  return invoke<BrokerAccount>("broker_account");
}

export function brokerOrder(
  side: string,
  quantity: number,
  price: number,
  query?: string,
  secid?: string,
): Promise<BrokerOrderResult> {
  return invoke<BrokerOrderResult>("broker_order", { query, secid, side, quantity, price });
}

export function getWorkspace(): Promise<string | null> {
  return invoke<string | null>("get_workspace");
}

export function setWorkspace(path: string): Promise<string> {
  return invoke<string>("set_workspace", { path });
}

export async function pickFiles(): Promise<string[]> {
  const selected = await open({
    directory: false,
    multiple: true,
    title: t("pick.files"),
  });
  if (typeof selected === "string") return [selected];
  if (Array.isArray(selected)) return selected;
  return [];
}

export async function pickWorkspace(title = ""): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: title || t("pick.workspace"),
  });
  if (typeof selected !== "string") return null;
  return setWorkspace(selected);
}

export function beginTurn(): Promise<void> {
  return invoke("begin_turn");
}

export function cancelCompletion(): Promise<void> {
  return invoke("cancel_completion");
}

export function readPickedFile(path: string): Promise<string> {
  return invoke<string>("read_picked_file", { path });
}

export function readFile(
  path: string,
  offset?: number,
  limit?: number,
): Promise<ReadFileResult> {
  return invoke<ReadFileResult>("read_file", { path, offset, limit });
}

export function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path });
}

export function writeFile(path: string, content: string): Promise<WriteFileResult> {
  return invoke<WriteFileResult>("write_file", { path, content });
}

export function editFile(
  path: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): Promise<EditFileResult> {
  return invoke<EditFileResult>("edit_file", {
    path,
    oldString,
    newString,
    replaceAll,
  });
}

export function listDir(path?: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

export function grepWorkspace(
  pattern: string,
  path?: string,
  glob?: string,
): Promise<GrepResult> {
  return invoke<GrepResult>("grep_workspace", { pattern, path, glob });
}

export function globWorkspace(pattern: string): Promise<GlobResult> {
  return invoke<GlobResult>("glob_workspace", { pattern });
}

export function runCommand(
  command: string,
  cwd?: string,
  timeoutSec?: number,
): Promise<CommandOutput> {
  return invoke<CommandOutput>("run_command", { command, cwd, timeoutSec });
}

export function searchSecurities(query: string): Promise<SecuritySearch> {
  return invoke<SecuritySearch>("search_securities", { query });
}

export function quoteSecurity(secid: string): Promise<SecurityQuote> {
  return invoke<SecurityQuote>("quote_security", { secid });
}

export function securityHistory(secid: string, days?: number): Promise<SecurityHistory> {
  return invoke<SecurityHistory>("security_history", { secid, days });
}

export function paperAccount(): Promise<PaperAccount> {
  return invoke<PaperAccount>("paper_account");
}

export function listWatch(): Promise<WatchItem[]> {
  return invoke<WatchItem[]>("list_watch");
}

export function addWatch(query?: string, secid?: string): Promise<WatchItem> {
  return invoke<WatchItem>("add_watch", { query, secid });
}

export function removeWatch(secid: string): Promise<void> {
  return invoke<void>("remove_watch", { secid });
}

export function listPriceAlerts(): Promise<PriceAlert[]> {
  return invoke<PriceAlert[]>("list_price_alerts");
}

export function addPriceAlert(input: {
  query?: string;
  secid?: string;
  kind: string;
  price?: number;
  low?: number;
  high?: number;
  note?: string;
  side?: string;
  quantity?: number;
}): Promise<PriceAlert> {
  return invoke<PriceAlert>("add_price_alert", input);
}

export function removePriceAlert(id: string): Promise<void> {
  return invoke<void>("remove_price_alert", { id });
}

export function checkPriceAlerts(): Promise<PriceAlert[]> {
  return invoke<PriceAlert[]>("check_price_alerts");
}

export function paperOrder(
  side: string,
  quantity: number,
  query?: string,
  secid?: string,
): Promise<PaperOrderResult> {
  return invoke<PaperOrderResult>("paper_order", { query, secid, side, quantity });
}

export function grantAllow(key: string): Promise<string[]> {
  return invoke<string[]>("grant_allow", { key });
}

export function projectInstructions(): Promise<{ path: string; content: string } | null> {
  return invoke<{ path: string; content: string } | null>("project_instructions");
}

export function memoryIndex(workspace: string | null): Promise<string> {
  return invoke<string>("memory_index", { workspace });
}

export function readMemoryNote(workspace: string | null): Promise<string> {
  return invoke<string>("read_memory_note", { workspace });
}

export function rememberNote(workspace: string | null, note: string): Promise<string> {
  return invoke<string>("remember_note", { workspace, note });
}

export function skillIndex(workspace: string | null): Promise<string> {
  return invoke<string>("skill_index", { workspace });
}

export function readSkill(workspace: string | null, name: string): Promise<string> {
  return invoke<string>("read_skill", { workspace, name });
}

export interface SkillEntry {
  name: string;
  description: string;
  body: string;
  origin: "personal" | "project" | string;
  folder: string;
}

export function listSkills(workspace: string | null): Promise<SkillEntry[]> {
  return invoke<SkillEntry[]>("list_skills", { workspace });
}

export function saveSkill(name: string, description: string, body: string, previousFolder: string | null): Promise<void> {
  return invoke<void>("save_skill", { name, description, body, previousFolder });
}

export function deleteSkill(folder: string): Promise<void> {
  return invoke<void>("delete_skill", { folder });
}

export function testConnection(): Promise<string> {
  return invoke<string>("test_connection");
}

export function completeChat(
  messages: unknown[],
  tools: unknown[],
  onEvent: (event: StreamEvent) => void,
): Promise<CompletionResult> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  return invoke<CompletionResult>("complete_chat", {
    messages,
    tools,
    onEvent: channel,
  });
}
