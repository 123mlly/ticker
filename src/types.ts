export type PermissionMode = "ask" | "auto_edit" | "full";

export interface PublicSettings {
  provider: string;
  baseUrl: string;
  model: string;
  permissionMode: PermissionMode;
  workspace: string | null;
  hasApiKey: boolean;
  allows: string[];
}

export interface SettingsDraft {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  permissionMode: PermissionMode;
}

export type BrokerKind = "none" | "qmt" | "openapi" | "client";

export interface PublicBroker {
  kind: BrokerKind;
  account: string;
  qmtPath: string;
  pythonPath: string;
  commandPath: string;
  hasSecret: boolean;
}

export interface BrokerDraft {
  kind: BrokerKind;
  account: string;
  qmtPath: string;
  pythonPath: string;
  commandPath: string;
  secret: string;
}

export interface BrokerStatus {
  connected: boolean;
  kind: BrokerKind;
  account: string;
  message: string;
}

export interface BrokerPosition {
  code: string;
  name: string;
  quantity: number;
  available: number;
  cost: number;
  marketValue: number;
}

export interface BrokerAccount {
  account: string;
  cash: number;
  total: number;
  marketValue: number;
  positions: BrokerPosition[];
}

export interface BrokerOrderResult {
  orderId: string;
  side: string;
  symbol: string;
  code: string;
  name: string;
  quantity: number;
  price: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatImage {
  id: string;
  name: string;
  dataUrl: string;
}

export interface FileChange {
  path: string;
  kind: "edit" | "write";
  created: boolean;
  before: string | null;
  omitted: boolean;
  removed: string;
  added: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ChatImage[];
  change?: FileChange;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  args?: string;
  status?: "streaming" | "running" | "done" | "denied" | "error";
  kind?: "compact";
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  workspace: string | null;
  place?: "work" | "market" | "chat";
  listed?: boolean;
}

export interface ReadFileResult {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface WriteFileResult {
  path: string;
  bytes: number;
  created: boolean;
  previous: string | null;
  previousOmitted: boolean;
}

export interface EditFileResult {
  path: string;
  replacements: number;
  previous: string | null;
  previousOmitted: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
}

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepHit[];
  truncated: boolean;
}

export interface GlobResult {
  files: string[];
  truncated: boolean;
}

export interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

export interface CompletionResult {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
  cancelled: boolean;
  error: string | null;
  finishReason?: string | null;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "toolDelta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "done" };

export interface SecurityHit {
  code: string;
  name: string;
  kind: string;
  secid: string;
}

export interface WatchItem {
  secid: string;
  code: string;
  name: string;
  kind: string;
}

export interface SecuritySearch {
  items: SecurityHit[];
  truncated: boolean;
}

export interface SecurityQuote {
  secid: string;
  code: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  amount: number;
  turnover?: number | null;
  pe?: number | null;
  marketCap?: number | null;
}

export interface DailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  changePct: number;
  amount: number;
}

export interface SecurityHistory {
  secid: string;
  code: string;
  name: string;
  bars: DailyBar[];
}

export interface PaperPosition {
  secid: string;
  code: string;
  name: string;
  kind: string;
  quantity: number;
  cost: number;
  price?: number | null;
}

export interface PaperAccount {
  cash: number;
  positions: PaperPosition[];
}

export interface PriceAlert {
  id: string;
  secid: string;
  code: string;
  name: string;
  kind: "below" | "above" | "between" | string;
  price: number | null;
  low: number | null;
  high: number | null;
  note: string;
  armed: boolean;
  triggeredPrice: number | null;
  side: string;
  quantity: number | null;
  outcome: string;
  outcomeNote: string;
}

export interface PaperOrderResult {
  side: string;
  code: string;
  name: string;
  kind: string;
  quantity: number;
  price: number;
  account: PaperAccount;
}

export interface ApprovalRequest {
  call: ToolCall;
  title: string;
  subtitle: string;
  before?: string;
  after?: string;
  command?: string;
  allowKey?: string;
}

export interface ApiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type ApiContent =
  | string
  | null
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: ApiContent;
  tool_calls?: ApiToolCall[];
  tool_call_id?: string;
}
