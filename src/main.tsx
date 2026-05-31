import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Database,
  FileUp,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  Sparkles
} from "lucide-react";
import "./styles.css";

type View = "day" | "week" | "month";
type Scope = "week" | "month";

type Task = {
  id: string;
  date: string;
  file: string;
  line: number;
  text: string;
  completed: boolean;
};

type Note = {
  id: number;
  date: string;
  file: string;
  title: string;
  html: string;
};

type Summary = {
  id: number;
  date: string;
  content: string;
  createdAt: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type Config = {
  dataPath: string;
  llmConfigured: boolean;
  llmModel: string;
};

type DayPayload = {
  date: string;
  notes: Note[];
  tasks: Task[];
  summaries: Summary[];
};

type Progress = {
  total: number;
  completed: number;
  percent: number;
};

type LlmStatus = {
  ok: boolean;
  message: string;
  model: string;
};

const today = new Date().toISOString().slice(0, 10);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function scopeFromView(view: View): Scope {
  return view === "month" ? "month" : "week";
}

function App() {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [dates, setDates] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [progress, setProgress] = useState<Progress>({ total: 0, completed: 0, percent: 0 });
  const [llm, setLlm] = useState<LlmStatus>({ ok: false, message: "尚未检查", model: "gpt-4o-mini" });
  const [day, setDay] = useState<DayPayload | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [rangeSummary, setRangeSummary] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const dayCompletion = useMemo(() => {
    const tasks = day?.tasks || [];
    if (!tasks.length) return 0;
    return Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
  }, [day]);

  const aiDisabled = !llm.ok || busy;

  async function refreshBase(nextDate = date) {
    const [configPayload, datesPayload, progressPayload, dayPayload, llmPayload] = await Promise.all([
      api<Config>("/api/config"),
      api<{ dates: string[] }>("/api/dates"),
      api<Progress>("/api/progress"),
      api<DayPayload>(`/api/day/${nextDate}`),
      api<LlmStatus>("/api/llm/status")
    ]);
    setConfig(configPayload);
    setDates(datesPayload.dates);
    setProgress(progressPayload);
    setDay(dayPayload);
    setLlm(llmPayload);
  }

  async function refreshRange(nextDate = date, nextView = view) {
    const scope = scopeFromView(nextView);
    const [summaryPayload, messagesPayload] = await Promise.all([
      api<{ generated: string }>(`/api/${scope}/${nextDate}`),
      api<{ messages: ChatMessage[] }>(`/api/${scope}/${nextDate}/messages`)
    ]);
    setRangeSummary(summaryPayload.generated);
    setMessages(messagesPayload.messages);
  }

  useEffect(() => {
    refreshBase().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setError("");
    refreshBase(date).catch((err) => setError(err.message));
    if (view !== "day") refreshRange(date, view).catch((err) => setError(err.message));
  }, [date]);

  async function changeView(nextView: View) {
    setView(nextView);
    setError("");
    if (nextView !== "day") {
      await refreshRange(date, nextView).catch((err) => setError(err.message));
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const content = await file.text();
      const payload = await api<{ duplicate: boolean; days: Array<{ date: string; taskCount: number }> }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content })
      });
      const firstDate = payload.days[0]?.date;
      if (firstDate) setDate(firstDate);
      setNotice(payload.duplicate ? "这个 Markdown 文件已经导入过。" : `导入完成：切分 ${payload.days.length} 天。`);
      await refreshBase(firstDate || date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: Task) {
    setError("");
    const previous = day;
    setDay((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, completed: !item.completed } : item))
          }
        : current
    );
    try {
      await api(`/api/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed })
      });
      const progressPayload = await api<Progress>("/api/progress");
      setProgress(progressPayload);
    } catch (err) {
      setDay(previous);
      setError(err instanceof Error ? err.message : "任务状态保存失败");
    }
  }

  async function saveSummary() {
    if (!summaryDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/summaries", {
        method: "POST",
        body: JSON.stringify({ date, content: summaryDraft })
      });
      setSummaryDraft("");
      await refreshBase(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function checkLlm() {
    setBusy(true);
    setError("");
    try {
      const payload = await api<LlmStatus>("/api/llm/check", { method: "POST" });
      setLlm(payload);
      setNotice(payload.ok ? "大模型检查通过。" : "大模型检查失败，AI 总结和对话已禁用。");
    } catch (err) {
      setLlm((current) => ({ ...current, ok: false, message: err instanceof Error ? err.message : "检查失败" }));
    } finally {
      setBusy(false);
    }
  }

  async function generateRange() {
    const scope = scopeFromView(view);
    setBusy(true);
    setError("");
    try {
      const payload = await api<{ generated: string }>(`/api/${scope}/${date}/summarize`, { method: "POST" });
      setRangeSummary(payload.generated);
      await refreshRange(date, view);
    } catch (err) {
      setLlm((current) => ({ ...current, ok: false, message: err instanceof Error ? err.message : "AI 调用失败" }));
      setError(err instanceof Error ? err.message : "总结失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    if (!chatDraft.trim()) return;
    const scope = scopeFromView(view);
    const content = chatDraft;
    setChatDraft("");
    setBusy(true);
    setError("");
    try {
      const payload = await api<{ messages: ChatMessage[] }>(`/api/${scope}/${date}/chat`, {
        method: "POST",
        body: JSON.stringify({ content })
      });
      setMessages(payload.messages);
    } catch (err) {
      setChatDraft(content);
      setLlm((current) => ({ ...current, ok: false, message: err instanceof Error ? err.message : "AI 调用失败" }));
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={22} />
          <div>
            <h1>Taw Knows</h1>
            <p>Markdown task memory</p>
          </div>
        </div>

        <div className="stickyProgress">
          <div>
            <span>全部任务进度</span>
            <strong>{progress.percent}%</strong>
          </div>
          <div className="progressLine">
            <span style={{ width: `${progress.percent}%` }} />
          </div>
          <p>
            {progress.completed}/{progress.total} 已完成
          </p>
        </div>

        <label className="uploadBox">
          <FileUp size={18} />
          <span>提交 Markdown 文件</span>
          <input type="file" accept=".md,text/markdown,text/plain" onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
        </label>

        <div className="segmented three">
          <button className={view === "day" ? "active" : ""} onClick={() => changeView("day")}>
            <CalendarDays size={16} /> 当日
          </button>
          <button className={view === "week" ? "active" : ""} onClick={() => changeView("week")}>
            <Bot size={16} /> 周
          </button>
          <button className={view === "month" ? "active" : ""} onClick={() => changeView("month")}>
            <Bot size={16} /> 月
          </button>
        </div>

        <div className="dateBox">
          <label htmlFor="date">选择日期</label>
          <div className="dateControls">
            <button aria-label="前一天" onClick={() => setDate(shiftDate(date, -1))}>
              <ChevronLeft size={18} />
            </button>
            <input id="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <button aria-label="后一天" onClick={() => setDate(shiftDate(date, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div className="knownDates">
          <h2>已导入日期</h2>
          <div className="dateList">
            {dates.length ? (
              dates.map((item) => (
                <button key={item} className={item === date ? "current" : ""} onClick={() => setDate(item)}>
                  {item}
                </button>
              ))
            ) : (
              <p>还没有导入 Markdown。</p>
            )}
          </div>
        </div>

        <div className={`llmStatus ${llm.ok ? "ok" : "fail"}`}>
          <div>
            <Bot size={15} />
            <span>{llm.ok ? "LLM 可用" : "LLM 不可用"}</span>
          </div>
          <p>{llm.message}</p>
          <button className="iconText" onClick={checkLlm} disabled={busy}>
            <RefreshCw size={15} /> 检查大模型
          </button>
        </div>

        {config && (
          <div className="systemInfo">
            <p>
              <Database size={14} /> {config.dataPath}
            </p>
            <p>
              <Bot size={14} /> {config.llmModel}
            </p>
          </div>
        )}
      </aside>

      <section className="content">
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        {view === "day" ? (
          <DayView
            date={date}
            day={day}
            completion={dayCompletion}
            summaryDraft={summaryDraft}
            setSummaryDraft={setSummaryDraft}
            saveSummary={saveSummary}
            toggleTask={toggleTask}
            busy={busy}
            refresh={() => refreshBase(date)}
          />
        ) : (
          <RangeView
            scope={scopeFromView(view)}
            date={date}
            summary={rangeSummary}
            messages={messages}
            chatDraft={chatDraft}
            setChatDraft={setChatDraft}
            generateRange={generateRange}
            sendChat={sendChat}
            busy={busy}
            aiDisabled={aiDisabled}
          />
        )}
      </section>
    </main>
  );
}

function DayView(props: {
  date: string;
  day: DayPayload | null;
  completion: number;
  summaryDraft: string;
  setSummaryDraft: (value: string) => void;
  saveSummary: () => void;
  toggleTask: (task: Task) => void;
  refresh: () => void;
  busy: boolean;
}) {
  const { date, day, completion, summaryDraft, setSummaryDraft, saveSummary, toggleTask, refresh, busy } = props;

  return (
    <div className="singleColumn">
      <section className="mainPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Daily board</p>
            <h2>{date}</h2>
          </div>
          <button className="iconText" onClick={refresh}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>

        <div className="progressLine">
          <span style={{ width: `${completion}%` }} />
        </div>
        <p className="muted">当天完成度 {completion}%</p>

        <div className="taskList">
          {(day?.tasks || []).length ? (
            day?.tasks.map((task) => (
              <button key={task.id} className="taskRow taskButton" onClick={() => toggleTask(task)}>
                {task.completed ? <CheckCircle2 className="done" size={20} /> : <Circle className="todo" size={20} />}
                <div>
                  <p>{task.text}</p>
                  <span>
                    {task.file}:{task.line}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <div className="emptyState">这一天没有解析到 Markdown checkbox 任务。</div>
          )}
        </div>

        <div className="notesPreview">
          <h3>Markdown 预览</h3>
          {(day?.notes || []).map((note) => (
            <article key={note.id} className="noteBlock">
              <header>
                <strong>{note.title}</strong>
                <span>{note.file}</span>
              </header>
              <div className="markdown" dangerouslySetInnerHTML={{ __html: note.html }} />
            </article>
          ))}
        </div>

        <div className="dailySummaryBottom">
          <h3>当天总结</h3>
          <textarea
            value={summaryDraft}
            onChange={(event) => setSummaryDraft(event.target.value)}
            placeholder="记录今天推进了什么、卡住了什么、明天要保留的判断..."
          />
          <button className="primary" disabled={busy || !summaryDraft.trim()} onClick={saveSummary}>
            <Save size={16} /> 保存总结
          </button>

          <div className="summaryHistory">
            {(day?.summaries || []).map((summary) => (
              <article key={summary.id}>
                <time>{summary.createdAt}</time>
                <p>{summary.content}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function RangeView(props: {
  scope: Scope;
  date: string;
  summary: string;
  messages: ChatMessage[];
  chatDraft: string;
  setChatDraft: (value: string) => void;
  generateRange: () => void;
  sendChat: () => void;
  busy: boolean;
  aiDisabled: boolean;
}) {
  const { scope, date, summary, messages, chatDraft, setChatDraft, generateRange, sendChat, busy, aiDisabled } = props;
  const label = scope === "month" ? "月总结" : "周总结";
  return (
    <div className="weekGrid">
      <section className="mainPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">{scope === "month" ? "Monthly synthesis" : "Weekly synthesis"}</p>
            <h2>
              {date} 所在{scope === "month" ? "月" : "周"}
            </h2>
          </div>
          <button className="primary" onClick={generateRange} disabled={aiDisabled}>
            <Sparkles size={16} /> 生成{label}
          </button>
        </div>
        <pre className="weeklyText">{summary || `切到${label}后会显示当前范围的本地语料概览。`}</pre>
      </section>

      <aside className="chatPanel">
        <div className="chatTitle">
          <MessageSquareText size={18} />
          <h3>{scope === "month" ? "本月语料对话" : "本周语料对话"}</h3>
        </div>
        <div className="messages">
          {messages.length ? (
            messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <span>{message.role === "user" ? "你" : "助手"}</span>
                <p>{message.content}</p>
              </article>
            ))
          ) : (
            <div className="emptyState">还没有对话记录。</div>
          )}
        </div>
        <div className="chatInput">
          <textarea
            value={chatDraft}
            onChange={(event) => setChatDraft(event.target.value)}
            placeholder={scope === "month" ? "围绕这个月的任务和小结提问..." : "围绕这一周的任务和小结提问..."}
            disabled={aiDisabled}
          />
          <button aria-label="发送" onClick={sendChat} disabled={aiDisabled || !chatDraft.trim() || busy}>
            <Send size={18} />
          </button>
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
