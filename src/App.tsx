import { useEffect, useRef, useState } from "react";
import { errorText, runAgent, type AgentMode } from "./agent";
import {
  beginTurn,
  cancelCompletion,
  checkPriceAlerts,
  getSettings,
  getWorkspace,
  grantAllow,
  inDesktopApp,
  deleteFile,
  pickFiles,
  pickWorkspace,
  readPickedFile,
  saveSettings,
  setWorkspace as activateWorkspace,
  testConnection,
  writeFile,
} from "./api";
import { localizeBackend, t, type Locale } from "./i18n";
import { createSession, isPlaceholderTitle, loadRepos, loadSessions, mergeRepos, repoKey, saveRepos, saveSessions, titleFrom, uid } from "./session";
import type {
  ApprovalRequest,
  ChatImage,
  ChatMessage,
  FileChange,
  PermissionMode,
  PriceAlert,
  ReadFileResult,
  Session,
  SettingsDraft,
} from "./types";
import {
  ApprovalCard,
  Composer,
  modelSeesImages,
  PreviewPane,
  Mark,
  ModeIcon,
  WindowTitle,
  SettingsPage,
  Sidebar,
  Transcript,
  WatchBoard,
  readUserName,
  writeUserName,
  type ModelChoice,
} from "./view";

const EMPTY_DRAFT: SettingsDraft = {
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-6.1-sol",
  apiKey: "",
  permissionMode: "ask",
};

export default function App({ locale }: { locale: Locale }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState<ApprovalRequest | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<ReadFileResult | null>(null);
  const [notice, setNotice] = useState("");
  const [priceHits, setPriceHits] = useState<PriceAlert[]>([]);
  const [composerHint, setComposerHint] = useState("");
  const [composerFocus, setComposerFocus] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [repos, setRepos] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [images, setImages] = useState<ChatImage[]>([]);
  const [userName, setUserName] = useState(readUserName);
  const [agentMode, setAgentMode] = useState<AgentMode>(readAgentMode);
  const modeRef = useRef<AgentMode>(agentMode);
  modeRef.current = agentMode;

  useEffect(() => {
    if (!inDesktopApp()) return;
    let stop = false;
    const tick = async () => {
      try {
        const fired = await checkPriceAlerts();
        if (stop || fired.length === 0) return;
        setPriceHits((current) => {
          const seen = new Set(current.map((item) => item.id));
          const next = fired.filter((item) => !seen.has(item.id));
          return next.length === 0 ? current : [...current, ...next];
        });
      } catch {
        // The next pass can retry a failed quote check.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 60_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const stopRef = useRef(false);
  const runningRef = useRef(false);
  const decisionRef = useRef<((allowed: boolean) => void) | null>(null);
  const allowsRef = useRef<string[]>([]);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const trail = useRef<string[]>([]);
  const trailAt = useRef(-1);
  const [trailView, setTrailView] = useState({ index: -1, length: 0 });

  useEffect(() => {
    const loaded = loadSessions();
    setSessions(loaded);
    setActiveId(loaded[0]?.id ?? "");
    if (loaded[0]) pushTrail(loaded[0].id);
    setRepos(mergeRepos(loadRepos(), loaded.map((session) => session.workspace)));
    setReady(true);
    if (inDesktopApp()) void refresh();
  }, []);

  useEffect(() => {
    if (ready) saveSessions(sessions);
  }, [sessions, ready]);

  useEffect(() => {
    if (ready) saveRepos(repos);
  }, [repos, ready]);

  useEffect(() => {
    if (!inDesktopApp()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) => getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== "drop" || runningRef.current) return;
        acceptFiles(event.payload.paths);
      }))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [workspace, agentMode]);

  const active = sessions.find((session) => session.id === activeId) ?? sessions[0];

  async function refresh() {
    try {
      const [settings, folder] = await Promise.all([getSettings(), getWorkspace()]);
      const savedFolder = folder ?? settings.workspace;
      if (savedFolder) setRepos((prev) => mergeRepos(prev, [savedFolder]));
      const current = sessionsRef.current[0];
      setWorkspace(current?.workspace ?? null);
      setHasApiKey(settings.hasApiKey);
      setDraft({
        provider: settings.provider || "openai",
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: "",
        permissionMode: settings.permissionMode,
      });
      allowsRef.current = settings.allows ?? [];
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function commit(sessionId: string, messages: ChatMessage[]) {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const untitled = isPlaceholderTitle(session.title);
        const title = untitled ? titleFrom(messages) : session.title;
        return {
          ...session,
          title,
          messages,
          updatedAt: Date.now(),
          workspace: session.workspace ?? workspace,
        };
      }),
    );
  }

  function decide(allowed: boolean, always = false) {
    if (allowed && always && pending?.allowKey && !allowsRef.current.includes(pending.allowKey)) {
      const key = pending.allowKey;
      allowsRef.current = [...allowsRef.current, key];
      void grantAllow(key).catch(() => undefined);
    }
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setPending(null);
    resolve?.(allowed);
  }

  function requestApproval(request: ApprovalRequest): Promise<boolean> {
    setPending(request);
    return new Promise((resolve) => {
      decisionRef.current = resolve;
    });
  }

  async function openFolder(title?: string) {
    setNotice("");
    try {
      const folder = await pickWorkspace(title);
      if (folder) focusRepo(folder);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function forgetRepo(path: string) {
    setRepos((prev) => prev.filter((item) => repoKey(item) !== repoKey(path)));
  }

  function focusRepo(folder: string) {
    setRepos((prev) => mergeRepos(prev, [folder]));
    setWorkspace(folder);
    setComposerHint("");
    setPreview(null);
    const current = sessionsRef.current.find((session) => session.id === activeId);
    if (current && current.messages.length === 0 && (current.place ?? "work") === "work") {
      setSessions((prev) =>
        prev.map((session) => (session.id === current.id ? { ...session, workspace: folder, updatedAt: Date.now() } : session)),
      );
      return;
    }
    if (current?.workspace && repoKey(current.workspace) === repoKey(folder)) return;
    const session = createSession(folder);
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setInput("");
    pushTrail(session.id);
  }

  function pushTrail(id: string) {
    const next = trail.current.slice(0, trailAt.current + 1);
    if (next[next.length - 1] !== id) next.push(id);
    trail.current = next.slice(-40);
    trailAt.current = trail.current.length - 1;
    setTrailView({ index: trailAt.current, length: trail.current.length });
  }

  function applySession(session: Session) {
    setActiveId(session.id);
    setInput("");
    setNotice("");
    setComposerHint("");
    setPreview(null);
    setAttachments([]);
    setImages([]);
    if (session.workspace) {
      setWorkspace(session.workspace);
      void activateWorkspace(session.workspace).catch((error: unknown) => setNotice(errorText(error)));
    } else {
      setWorkspace(null);
    }
  }

  function stop() {
    stopRef.current = true;
    void cancelCompletion();
    decide(false);
  }

  function acceptFiles(paths: string[]) {
    if (modeRef.current !== "work") {
      const picked = paths.map((item) => item.trim()).filter(Boolean);
      if (picked.length === 0) return;
      setComposerHint("");
      setAttachments((prev) => {
        const next = [...prev];
        for (const file of picked) {
          if (!next.includes(file)) next.push(file);
        }
        return next.slice(0, 8);
      });
      return;
    }
    if (!workspace) {
      setComposerHint(t("notice.pickProject"));
      return;
    }
    setComposerHint("");
    const accepted: string[] = [];
    let skipped = 0;
    for (const path of paths) {
      const relative = relativeToWorkspace(workspace, path);
      if (!relative) {
        skipped += 1;
        continue;
      }
      accepted.push(relative);
    }
    if (skipped > 0) setNotice(t("notice.outside"));
    else if (accepted.length > 0) setNotice("");
    if (accepted.length === 0) return;
    setAttachments((prev) => {
      const next = [...prev];
      for (const file of accepted) {
        if (!next.includes(file)) next.push(file);
      }
      return next.slice(0, 12);
    });
  }

  async function addFiles() {
    if (runningRef.current) return;
    if (modeRef.current === "work" && !workspace) {
      setComposerHint(t("notice.pickProject"));
      return;
    }
    try {
      acceptFiles(await pickFiles());
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function fileNote(files: string[]): Promise<string> {
    if (files.length === 0) return "";
    if (modeRef.current === "work") {
      return t("send.files", { files: files.map((file) => `- ${file}`).join("\n") });
    }
    const blocks: string[] = [];
    for (const file of files) {
      try {
        const text = await readPickedFile(file);
        const name = file.split(/[/\\]/).pop() || file;
        blocks.push(`### ${name}\n${text}`);
      } catch (error) {
        setNotice(errorText(error));
      }
    }
    return blocks.length === 0 ? "" : t("send.attached", { files: blocks.join("\n\n") });
  }

  async function addImages(files: File[]) {
    if (runningRef.current) return;
    const next: ChatImage[] = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 15_000_000) {
        setNotice(t("notice.imageBig"));
        continue;
      }
      try {
        next.push({ id: uid(), name: file.name || t("composer.image"), dataUrl: await shrinkImage(file) });
      } catch (error) {
        setNotice(errorText(error));
      }
    }
    if (next.length === 0) return;
    setImages((prev) => [...prev, ...next].slice(0, 4));
  }

  async function send(
    text: string,
    options?: { base?: ChatMessage[]; shots?: ChatImage[]; keepDraft?: boolean },
  ) {
    const body = text.trim();
    const files = options?.keepDraft ? [] : attachments;
    const shots = (options?.shots ?? images).filter((image) => image.dataUrl);
    if ((!body && files.length === 0 && shots.length === 0) || runningRef.current) return;
    const attached = await fileNote(files);
    if (runningRef.current) return;
    if (!body && !attached && shots.length === 0) return;
    const target = options?.base ? active : ensureThread();
    if (!target) return;
    const content = [body, attached].filter(Boolean).join("\n\n");
    setNotice("");
    if (!options?.keepDraft) {
      setInput("");
      setAttachments([]);
      setImages([]);
    }
    stopRef.current = false;
    runningRef.current = true;
    setRunning(true);
    const sessionId = target.id;
    const history = [
      ...(options?.base ?? target.messages),
      { id: `user-${Date.now()}`, role: "user" as const, content: content || t("send.image"), images: shots },
    ];
    commit(sessionId, history);
    try {
      await beginTurn();
      await runAgent({
        messages: history,
        workspace,
        mode: modeRef.current,
        permissionMode: draft.permissionMode,
        allows: () => allowsRef.current,
        shouldStop: () => stopRef.current,
        approve: requestApproval,
        onMessages: (messages) => commit(sessionId, messages),
        onStatus: setStatus,
        onWorkspaceChanged: () => undefined,
      });
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      runningRef.current = false;
      setRunning(false);
      setStatus(null);
      setPending(null);
    }
  }

  function rewriteFrom(id: string, text: string) {
    if (runningRef.current || !active) return;
    const index = active.messages.findIndex((message) => message.id === id);
    const message = active.messages[index];
    if (!message || message.role !== "user") return;
    void send(text, { base: active.messages.slice(0, index), shots: message.images ?? [], keepDraft: true });
  }

  async function revertChanges(changes: FileChange[]) {
    if (runningRef.current) return;
    const first = new Map<string, FileChange>();
    for (const change of changes) {
      if (!first.has(change.path)) first.set(change.path, change);
    }
    const skipped: string[] = [];
    try {
      for (const change of first.values()) {
        if (change.omitted || (!change.created && change.before === null)) {
          skipped.push(change.path);
          continue;
        }
        if (change.created) await deleteFile(change.path);
        else await writeFile(change.path, change.before ?? "");
      }
      setNotice(skipped.length > 0 ? t("notice.revertedSome", { names: skipped.join(", ") }) : t("notice.reverted"));
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  function ensureThread(): Session | null {
    const place = modeRef.current;
    const current = sessionsRef.current.find((session) => session.id === activeId) ?? null;
    if (place === "work") {
      if (current && (current.place ?? "work") === "work") return current;
      const session = createSession(workspace, false, "work");
      setSessions((prev) => [session, ...prev]);
      applySession(session);
      pushTrail(session.id);
      return session;
    }
    if (current?.place === place) return current;
    const blank = sessionsRef.current.find((session) => session.place === place && !session.listed && session.messages.length === 0);
    if (blank) {
      applySession(blank);
      pushTrail(blank.id);
      return blank;
    }
    const session = createSession(null, false, place);
    setSessions((prev) => [session, ...prev]);
    applySession(session);
    pushTrail(session.id);
    return session;
  }

  function newChat(folder: string | null, listed = false, placeOverride?: AgentMode) {
    if (runningRef.current) return;
    setInput("");
    setNotice("");
    setComposerHint("");
    const place = placeOverride ?? (listed || modeRef.current === "work" ? "work" : modeRef.current);
    if (place === "chat" || place === "market" || place === "work") chooseMode(place);
    if (place === "chat") setComposerFocus((value) => value + 1);
    const home = place === "work" ? folder : null;
    if (listed) {
      const session = createSession(home, true, "work");
      setSessions((prev) => [session, ...prev]);
      applySession(session);
      pushTrail(session.id);
      return;
    }
    const samePlace = (session: Session) => {
      if ((session.place ?? "work") !== place) return false;
      if (session.listed || session.messages.length > 0) return false;
      if (place !== "work") return true;
      if (!home || !session.workspace) return !home && !session.workspace;
      return repoKey(session.workspace) === repoKey(home);
    };
    const existing = sessionsRef.current.find(samePlace);
    if (existing) {
      applySession(existing);
      pushTrail(existing.id);
      return;
    }
    const session = createSession(home, false, place);
    setSessions((prev) => [session, ...prev]);
    applySession(session);
    pushTrail(session.id);
  }

  function selectSession(id: string) {
    if (runningRef.current) return;
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;
    applySession(session);
    if (session.place === "market" || session.place === "chat") chooseMode(session.place);
    else chooseMode("work");
    pushTrail(id);
  }

  function moveTrail(delta: number) {
    if (runningRef.current) return;
    const index = trailAt.current + delta;
    const id = trail.current[index];
    if (!id) return;
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;
    trailAt.current = index;
    setTrailView({ index, length: trail.current.length });
    applySession(session);
    if (session.place === "market" || session.place === "chat") chooseMode(session.place);
    else chooseMode("work");
  }

  function removeChat(id: string) {
    if (runningRef.current && id === activeId) return;
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    if (remaining.length === 0) {
      const removed = sessionsRef.current.find((session) => session.id === id);
      const fresh = createSession(removed?.workspace ?? null);
      setSessions([fresh]);
      setActiveId(fresh.id);
      pushTrail(fresh.id);
      return;
    }
    setSessions(remaining);
    if (activeId === id) {
      setActiveId(remaining[0].id);
      pushTrail(remaining[0].id);
    }
  }

  async function changeModel(choice: ModelChoice) {
    const next = {
      ...draft,
      provider: choice.provider,
      baseUrl: choice.baseUrl,
      model: choice.id,
      apiKey: "",
    };
    setDraft(next);
    try {
      const saved = await saveSettings(next);
      setDraft({
        ...next,
        apiKey: "",
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
      });
      setHasApiKey(saved.hasApiKey);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function changeMode(mode: PermissionMode) {
    const next = { ...draft, permissionMode: mode, apiKey: "" };
    setDraft(next);
    try {
      const saved = await saveSettings(next);
      setDraft({ ...next, apiKey: "", permissionMode: saved.permissionMode });
      setHasApiKey(saved.hasApiKey);
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  async function saveDraft() {
    setTesting(true);
    setTestMessage("");
    try {
      const saved = await saveSettings(draft);
      setHasApiKey(saved.hasApiKey);
      setDraft({
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        apiKey: "",
        permissionMode: saved.permissionMode,
      });
      setTestMessage(t("settings.saved"));
    } catch (error) {
      setTestMessage(errorText(error));
    } finally {
      setTesting(false);
    }
  }

  async function probe() {
    setTesting(true);
    setTestMessage("");
    try {
      const saved = await saveSettings(draft);
      setHasApiKey(saved.hasApiKey);
      setDraft({
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        model: saved.model,
        apiKey: "",
        permissionMode: saved.permissionMode,
      });
      setTestMessage(localizeBackend(await testConnection()));
    } catch (error) {
      setTestMessage(errorText(error));
    } finally {
      setTesting(false);
    }
  }

  function renameUser(value: string) {
    setUserName(value);
    writeUserName(value);
  }

  function chooseMode(next: AgentMode) {
    modeRef.current = next;
    setAgentMode(next);
    localStorage.setItem(MODE_KEY, next);
  }

  function askMarket(text: string) {
    chooseMode("market");
    void send(text);
  }

  const folderName = workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() ?? null : null;
  const threadEmpty = (active?.messages.length ?? 0) === 0;

  return (
    <div className={preview ? "app with-preview" : "app"} data-locale={locale}>
      {inDesktopApp() ? <WindowTitle /> : null}
      {draft.permissionMode === "full" ? (
        <div className="banner">{t("banner.full")}</div>
      ) : null}
      {notice ? <div className="banner warn">{notice}</div> : null}
      {priceHits.map((alert) => (
        <div key={alert.id} className="banner alert" role="status">
          <span>{priceHitText(alert)}</span>
          <button type="button" onClick={() => setPriceHits((current) => current.filter((item) => item.id !== alert.id))}>
            {t("alert.dismiss")}
          </button>
        </div>
      ))}
      <div className={sidebarOpen ? "body" : "body sidebar-closed"}>
        <Sidebar
          sessions={sessions}
          repos={repos}
          activeId={active?.id ?? ""}
          disabled={running}
          canBack={trailView.index > 0}
          canForward={trailView.index >= 0 && trailView.index < trailView.length - 1}
          customizeActive={settingsOpen}
          onBack={() => moveTrail(-1)}
          onForward={() => moveTrail(1)}
          onCustomize={() => {
            setPreview(null);
            setSettingsOpen(true);
            setTestMessage("");
          }}
          onSelect={selectSession}
          onNew={newChat}
          onDelete={removeChat}
          onAddRepo={(title) => void openFolder(title)}
          onUseRepo={focusRepo}
          onForgetRepo={forgetRepo}
          userName={userName}
          onRename={renameUser}
          onToggle={() => setSidebarOpen(false)}
          onPrompt={askMarket}
        />
        <section className={threadEmpty ? "main is-empty" : "main"}>
          <header className="threadbar">
            {sidebarOpen ? null : (
              <button type="button" className="icon-button sidebar-toggle" aria-label={t("nav.expand")} onClick={() => setSidebarOpen(true)}>
                <Mark />
              </button>
            )}
            <span className="project-label">{agentMode === "work" ? (folderName ?? "") : ""}</span>
            <div className={`surface-switch mode-${agentMode}`} role="tablist" aria-label={t("mode.switch")}>
              <span className="switch-thumb" aria-hidden="true" />
              <button type="button" role="tab" aria-selected={agentMode === "chat"} className={agentMode === "chat" ? "active" : ""} disabled={running} onClick={() => chooseMode("chat")}>
                <ModeIcon mode="chat" />
                {t("mode.chat")}
              </button>
              <button type="button" role="tab" aria-selected={agentMode === "market"} className={agentMode === "market" ? "active" : ""} disabled={running} onClick={() => chooseMode("market")}>
                <ModeIcon mode="market" />
                {t("mode.market")}
              </button>
              <button type="button" role="tab" aria-selected={agentMode === "work"} className={agentMode === "work" ? "active" : ""} disabled={running} onClick={() => chooseMode("work")}>
                <ModeIcon mode="work" />
                {t("mode.work")}
              </button>
            </div>
          </header>
          {agentMode === "market" ? <WatchBoard /> : null}
          <Transcript
            messages={active?.messages ?? []}
            status={status}
            onRewrite={rewriteFrom}
            onRevert={(changes) => void revertChanges(changes)}
          />
          {pending ? <ApprovalCard request={pending} onDecide={decide} /> : null}
          <div className="dock">
            <Composer
              value={input}
              running={running}
              placeholder={threadEmpty ? (agentMode === "market" ? t("placeholder.market") : agentMode === "work" ? t("placeholder.work") : t("placeholder.chat")) : t("placeholder.follow")}
              blank={threadEmpty}
              surface={agentMode}
              projectName={folderName}
              permissionMode={draft.permissionMode}
              provider={draft.provider}
              model={draft.model}
              onPickProject={() => void openFolder()}
              onMode={(mode) => void changeMode(mode)}
              onModel={(model) => void changeModel(model)}
              files={attachments}
              images={images}
              hint={composerHint}
              focusToken={composerFocus}
              onAddFiles={() => void addFiles()}
              onPasteImages={(files) => void addImages(files)}
              onRemoveFile={(file) => setAttachments((prev) => prev.filter((item) => item !== file))}
              onRemoveImage={(id) => setImages((prev) => prev.filter((image) => image.id !== id))}
              seesImages={modelSeesImages(draft.model)}
              onChange={setInput}
              onSuggest={(text) => void send(text)}
              onSend={() => void send(input)}
              onStop={stop}
            />
          </div>
        </section>
        {preview ? <PreviewPane file={preview} onClose={() => setPreview(null)} /> : null}
        {settingsOpen ? (
          <SettingsPage
            draft={draft}
            hasApiKey={hasApiKey}
            testing={testing}
            testMessage={testMessage}
            userName={userName}
            onRename={renameUser}
            onChange={setDraft}
            onMode={(mode) => void changeMode(mode)}
            workspace={workspace}
            onClose={() => setSettingsOpen(false)}
            onSave={() => void saveDraft()}
            onTest={() => void probe()}
          />
        ) : null}
      </div>
    </div>
  );
}

const MODE_KEY = "forge.surface.v1";

function priceHitText(alert: PriceAlert): string {
  const rule = alert.kind === "above"
    ? t("alert.above", { price: alertPrice(alert.price) })
    : alert.kind === "between"
      ? t("alert.between", { low: alertPrice(alert.low), high: alertPrice(alert.high) })
      : t("alert.below", { price: alertPrice(alert.price) });
  const note = alert.note ? t("alert.note", { note: alert.note }) : "";
  if (alert.side === "buy" || alert.side === "sell") {
    const verb = alert.side === "sell" ? t("approval.paperSell") : t("approval.paperBuy");
    if (alert.outcome === "failed") {
      return t("alert.failed", { name: alert.name, code: alert.code, reason: localizeBackend(alert.outcomeNote) });
    }
    return t("alert.filled", {
      verb,
      name: alert.name,
      code: alert.code,
      qty: alert.quantity ?? 0,
      price: alertPrice(alert.triggeredPrice),
      cash: alert.outcomeNote,
      rule,
      note,
    });
  }
  return t("alert.hit", {
    name: alert.name,
    code: alert.code,
    price: alertPrice(alert.triggeredPrice),
    rule,
    note,
  });
}

function alertPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function readAgentMode(): AgentMode {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === "chat") {
    localStorage.setItem(MODE_KEY, "market");
    return "market";
  }
  if (saved === "market") return "market";
  return "work";
}

function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1568;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error(t("notice.imageRead")));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("notice.imageRead")));
    };
    img.src = url;
  });
}

function relativeToWorkspace(workspace: string, file: string): string | null {
  const normalize = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/$/, "");
  const root = normalize(workspace);
  const target = normalize(file);
  const rootKey = root.toLowerCase();
  const targetKey = target.toLowerCase();
  if (!targetKey.startsWith(`${rootKey}/`)) return null;
  return target.slice(root.length + 1);
}
