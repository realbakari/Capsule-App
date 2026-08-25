import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Agent,
  AgentMode,
  ApprovalRequest,
  Artifact,
  ChatMessage,
  Project,
  Run,
  RunEvent,
  RuntimeStatus,
  Session,
  Skill,
  SubsystemStatus,
} from "@capsule/shared";

type View = "chat" | "agents" | "skills" | "history" | "settings" | "approvals";

const MODES: AgentMode[] = ["chat", "agent", "code", "research", "browser", "automation"];

function stepFromEvents(events: RunEvent[]): Array<{ id: string; label: string; status: string }> {
  const labels = [
    { id: "understand", label: "Understanding request" },
    { id: "route", label: "Selecting agent" },
    { id: "skill", label: "Loading skill" },
    { id: "tools", label: "Running tools" },
    { id: "verify", label: "Verifying result" },
  ];
  const seen = new Set(events.map((event) => String(event.data?.step ?? event.type)));
  const activeIndex = labels.findIndex((step) => {
    const present = events.some((event) => String(event.data?.step) === step.id);
    return !present;
  });
  return labels.map((step, index) => ({
    ...step,
    status:
      seen.has(step.id) && (activeIndex === -1 || index < activeIndex)
        ? "complete"
        : index === activeIndex || (activeIndex === -1 && index === labels.length - 1)
          ? seen.has(step.id) || activeIndex === -1
            ? "complete"
            : "active"
          : "pending",
  }));
}

export default function App() {
  const api = window.capsule;
  const [view, setView] = useState<View>("chat");
  const [status, setStatus] = useState<RuntimeStatus>();
  const [subsystems, setSubsystems] = useState<SubsystemStatus>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [projectId, setProjectId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [agentId, setAgentId] = useState<string>("general");
  const [mode, setMode] = useState<AgentMode>("chat");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [diagnostics, setDiagnostics] = useState<string>("");

  const project = projects.find((item) => item.id === projectId);
  const session = sessions.find((item) => item.id === sessionId);
  const activeRun = runs.find((run) => run.sessionId === sessionId && ["running", "approval_required", "waiting"].includes(run.status));
  const pendingApproval = approvals.find((item) => item.status === "pending");

  const refresh = useCallback(async () => {
    const [nextProjects, nextAgents, nextSkills, nextStatus, nextSub, nextApprovals] = await Promise.all([
      api.listProjects(),
      api.listAgents(),
      api.listSkills(),
      api.getStatus(),
      api.getSubsystemStatus(),
      api.listApprovals("pending"),
    ]);
    setProjects(nextProjects);
    setAgents(nextAgents);
    setSkills(nextSkills);
    setStatus(nextStatus);
    setSubsystems(nextSub);
    setApprovals(nextApprovals);
    const selectedProject = projectId ?? nextProjects[0]?.id;
    if (selectedProject && selectedProject !== projectId) setProjectId(selectedProject);
    if (selectedProject) {
      const nextSessions = await api.listSessions(selectedProject);
      setSessions(nextSessions);
      if (!sessionId && nextSessions[0]) setSessionId(nextSessions[0].id);
    }
  }, [api, projectId, sessionId]);

  const loadSession = useCallback(
    async (id: string) => {
      const [nextMessages, nextRuns] = await Promise.all([api.listMessages(id), api.listRuns(id)]);
      setMessages(nextMessages);
      setRuns(nextRuns);
      const latest = nextRuns[0];
      if (latest) {
        setEvents(await api.listRunEvents(latest.id));
        setArtifacts(await api.listArtifacts(latest.id));
      } else {
        setEvents([]);
        setArtifacts([]);
      }
    },
    [api],
  );

  useEffect(() => {
    void refresh();
    const off = [
      api.on("connection", () => void refresh()),
      api.on("message", () => {
        if (sessionId) void loadSession(sessionId);
      }),
      api.on("run", () => {
        if (sessionId) void loadSession(sessionId);
        void refresh();
      }),
      api.on("approval", () => void refresh()),
      api.on("state", (payload) => {
        const command = (payload as { command?: string }).command;
        if (command === "palette") setPalette(true);
        if (command === "new-task") void createTask();
        if (command === "approvals") setView("approvals");
        if (command === "runs") setView("history");
      }),
    ];
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off.forEach((fn) => fn());
      window.removeEventListener("keydown", onKey);
    };
  }, [api, loadSession, refresh, sessionId]);

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  async function createTask() {
    const targetProject = projectId ?? projects[0]?.id;
    if (!targetProject) return;
    const created = await api.createSession({
      projectId: targetProject,
      agentId,
      mode,
      title: "New conversation",
    });
    setSessionId(created.id);
    setView("chat");
    await refresh();
  }

  async function send() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      let currentSessionId = sessionId;
      let currentProjectId = projectId ?? projects[0]?.id;
      if (!currentProjectId) {
        const createdProject = await api.createProject({ name: "Inbox" });
        currentProjectId = createdProject.id;
        setProjectId(createdProject.id);
      }
      if (!currentSessionId) {
        const created = await api.createSession({
          projectId: currentProjectId,
          agentId,
          mode,
          title: "New conversation",
        });
        currentSessionId = created.id;
        setSessionId(created.id);
      }
      if (!currentSessionId) return;
      setDraft("");
      await api.sendMessage({
        sessionId: currentSessionId,
        content,
        agentId,
        mode,
      });
      await loadSession(currentSessionId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const commands = useMemo(
    () =>
      [
        { id: "new", label: "New task", run: () => createTask() },
        { id: "chat", label: "Open conversation", run: () => setView("chat") },
        { id: "projects", label: "Open project", run: () => setView("chat") },
        { id: "agents", label: "Switch agent", run: () => setView("agents") },
        { id: "skills", label: "Open skills", run: () => setView("skills") },
        { id: "runs", label: "Open active runs", run: () => setView("history") },
        { id: "approvals", label: "Open approvals", run: () => setView("approvals") },
        { id: "connect", label: "Connect OpenClaw", run: () => api.connectGateway() },
        { id: "reconnect", label: "Reconnect OpenClaw", run: () => api.connectGateway() },
        { id: "settings", label: "Open settings", run: () => setView("settings") },
      ].filter((command) => command.label.toLowerCase().includes(paletteQuery.toLowerCase())),
    [api, paletteQuery, projects, projectId, agentId, mode],
  );

  const steps = stepFromEvents(events);
  const connected = status?.state === "connected" && status.kind === "openclaw";

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="mark" />
          Capsule
        </div>
        <button className="status-pill" onClick={() => setView("settings")}>
          <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
          OpenClaw
          <span>{status?.state === "connected" ? (status.kind === "mock" ? "Mock" : "Connected") : status?.state ?? "Disconnected"}</span>
        </button>
      </header>
      <div className="shell">
        <aside className="sidebar" data-testid="app-sidebar">
          <button className="new-task" onClick={() => void createTask()}>
            New task
          </button>
          <div className="sidebar-scroll">
          <div className="nav-label">Projects</div>
          {projects.map((item) => (
            <button
              key={item.id}
              className={`list-item ${item.id === projectId ? "active" : ""}`}
              data-active={item.id === projectId}
              onClick={() => {
                setProjectId(item.id);
                setView("chat");
                void api.listSessions(item.id).then((next) => {
                  setSessions(next);
                  setSessionId(next[0]?.id);
                });
              }}
            >
              {item.name}
            </button>
          ))}
          <div className="nav-label">Agents</div>
          {agents.map((item) => (
            <button
              key={item.id}
              className={`list-item ${item.id === agentId ? "active" : ""}`}
              onClick={() => {
                setAgentId(item.id);
                setView("chat");
              }}
            >
              {item.name}
            </button>
          ))}
          <div className="nav-label">Library</div>
          <button className={`nav-item ${view === "skills" ? "active" : ""}`} onClick={() => setView("skills")}>
            Skills
          </button>
          <button className={`nav-item ${view === "history" ? "active" : ""}`} onClick={() => setView("history")}>
            History
          </button>
          <button className={`nav-item ${view === "approvals" ? "active" : ""}`} onClick={() => setView("approvals")}>
            Approvals
          </button>
          <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}>
            Settings
          </button>
          </div>
          <div className="sidebar-footer">
            <button className="list-item" onClick={() => setView("settings")}>
              <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
              {connected ? "OpenClaw connected" : status?.kind === "mock" ? "Local mock" : "Gateway offline"}
            </button>
          </div>
        </aside>
        {view === "chat" ? (
          <section className="main">
            <div className="conversation-header">
              {project?.name ?? "Inbox"}
              {session ? ` · ${session.title}` : ""}
            </div>
            <div className="conversation">
              {messages.length === 0 ? (
                <div className="hero">
                  <h1>What should Capsule work on?</h1>
                  <p>
                    Ask for a change, a review, or research. Capsule routes the work, records the run,
                    and keeps the project context.
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <div className="msg" key={message.id}>
                    <div className="who">
                      {message.role === "user" ? "You" : agents.find((item) => item.id === agentId)?.name ?? "Agent"}
                      <span className="when">{message.createdAt.slice(11, 16)}</span>
                    </div>
                    <div className="body">{message.content}</div>
                  </div>
                ))
              )}
              {activeRun && (
                <div className="msg">
                  <div className="who">Working on your task</div>
                  <div className="progress">
                    {steps.map((step) => (
                      <div className={`step ${step.status}`} key={step.id}>
                        <span className="glyph">
                          {step.status === "complete" ? "✓" : step.status === "active" ? "●" : "○"}
                        </span>
                        {step.label}
                      </div>
                    ))}
                  </div>
                  <details className="advanced">
                    <summary>Execution details</summary>
                    <div className="event-log">
                      {events.map((event) => (
                        <div key={event.id}>
                          {event.timestamp.slice(11, 19)} {event.message}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
              {pendingApproval && (
                <div className="approval">
                  <h3>Approval required</h3>
                  <div>
                    {pendingApproval.agentName} wants to <b>{pendingApproval.action}</b>
                  </div>
                  <div className="mono">{pendingApproval.target}</div>
                  <div className="muted">{pendingApproval.reason}</div>
                  <div className="actions">
                    <button className="send" onClick={() => void api.resolveApproval(pendingApproval.id, "approved_once")}>
                      Approve once
                    </button>
                    <button className="chip" onClick={() => void api.resolveApproval(pendingApproval.id, "approved_session")}>
                      Approve session
                    </button>
                    <button className="ghost" onClick={() => void api.resolveApproval(pendingApproval.id, "denied")}>
                      Deny
                    </button>
                  </div>
                </div>
              )}
              {artifacts.length > 0 && !activeRun && (
                <div className="msg">
                  <div className="who">Artifacts</div>
                  {artifacts.map((artifact) => (
                    <div className="card" key={artifact.id}>
                      <b>{artifact.title}</b>
                      <div className="muted">{artifact.kind}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="composer">
              <div className="composer-box">
                <textarea
                  value={draft}
                  placeholder="Ask Capsule to work on something..."
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="composer-row">
                  <div className="chips">
                    <span className="chip">+ Attach</span>
                    <span className="chip">@ Skill</span>
                    <select value={mode} onChange={(event) => setMode(event.target.value as AgentMode)}>
                      {MODES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                    <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                      {agents.map((item) => (
                        <option key={item.id} value={item.id}>
                          Agent: {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="send" disabled={busy || !draft.trim()} onClick={() => void send()}>
                    Send →
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="panel">
            {view === "agents" &&
              agents.map((item) => (
                <div className="card" key={item.id}>
                  <div className="row">
                    <div>
                      <b>{item.name}</b>
                      <div className="muted">{item.description}</div>
                    </div>
                    <span className="muted">{item.status}</span>
                  </div>
                </div>
              ))}
            {view === "skills" &&
              skills.map((item) => (
                <div className="card" key={item.id}>
                  <div className="row">
                    <div>
                      <b>{item.name}</b>
                      <div className="muted">{item.description}</div>
                    </div>
                    <span className="muted">{item.status}</span>
                  </div>
                </div>
              ))}
            {view === "history" &&
              runs.map((item) => (
                <div className="card" key={item.id}>
                  <div className="row">
                    <div>
                      <b>{item.prompt.slice(0, 80)}</b>
                      <div className="muted">{item.status}</div>
                    </div>
                    <span className="faint">{item.createdAt.slice(11, 19)}</span>
                  </div>
                </div>
              ))}
            {view === "approvals" && (
              <>
                {approvals.length === 0 && <p className="muted">No pending approvals.</p>}
                {approvals.map((item) => (
                  <div className="card" key={item.id}>
                    <b>{item.action}</b>
                    <div className="mono">{item.target}</div>
                    <div className="muted">{item.reason}</div>
                  </div>
                ))}
              </>
            )}
            {view === "settings" && (
              <>
                <div className="card">
                  <h3>OpenClaw</h3>
                  <p className="muted">
                    Capsule connects as an operator client to the Gateway WebSocket control plane
                    (protocol {status?.protocol ?? 4}).
                  </p>
                  <div className="grid-2">
                    <div>
                      <div className="faint">Gateway</div>
                      <div>{status?.gatewayHost}:{status?.gatewayPort}</div>
                    </div>
                    <div>
                      <div className="faint">Agents / sessions / runs</div>
                      <div>
                        {status?.agentCount ?? 0} / {status?.sessionCount ?? 0} / {status?.activeRunCount ?? 0}
                      </div>
                    </div>
                  </div>
                  <div className="actions">
                    <button className="send" onClick={() => void api.connectGateway()}>
                      Connect
                    </button>
                    <button className="ghost" onClick={() => void api.disconnectGateway()}>
                      Disconnect
                    </button>
                  </div>
                </div>
                <div className="card">
                  <h3>Create project</h3>
                  <div className="row">
                    <input
                      type="text"
                      placeholder="Project name"
                      value={newProjectName}
                      onChange={(event) => setNewProjectName(event.target.value)}
                    />
                    <button
                      className="chip"
                      onClick={async () => {
                        if (!newProjectName.trim()) return;
                        const created = await api.createProject({ name: newProjectName.trim() });
                        setNewProjectName("");
                        setProjectId(created.id);
                        await refresh();
                      }}
                    >
                      Create
                    </button>
                  </div>
                </div>
                <div className="card">
                  <h3>Diagnostics</h3>
                  <div className="muted">
                    Capsule core {subsystems?.capsuleCore} · Gateway {subsystems?.openclawGateway} · Buzz{" "}
                    {subsystems?.buzz} · Database {subsystems?.database} · Keychain {subsystems?.keychain}
                  </div>
                  <button
                    className="chip"
                    onClick={async () => {
                      const snapshot = await api.getDiagnostics();
                      setDiagnostics(JSON.stringify(snapshot, null, 2));
                    }}
                  >
                    Export sanitized diagnostics
                  </button>
                  {diagnostics && <pre className="mono">{diagnostics}</pre>}
                </div>
              </>
            )}
          </section>
        )}
      </div>
      {palette && (
        <div className="palette-backdrop" onClick={() => setPalette(false)}>
          <div className="palette" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              placeholder="Search commands..."
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
            />
            {commands.map((command) => (
              <button
                key={command.id}
                onClick={() => {
                  void command.run();
                  setPalette(false);
                  setPaletteQuery("");
                }}
              >
                {command.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
