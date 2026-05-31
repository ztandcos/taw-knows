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
  FileText,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  Sparkles
} from "lucide-react";
import "./styles.css";

type Task = {
  id: string;
  date: string;
  file: string;
  line: number;
  text: string;
  completed: boolean;
};

type Note = {
  date: string;
  file: string;
  title: string;
  html: string;
  tasks: Task[];
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

type DayPayload = {
  date: string;
  notes: Note[];
  tasks: Task[];
  summaries: Summary[];
};

type Config = {
  notesDir: string;
  dataPath: string;
  llmEnabled: boolean;
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

function App() {
  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState(today);
  const [dates, setDates] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [weeklySummary, setWeeklySummary] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const completion = useMemo(() => {
    const tasks = day?.tasks || [];
    if (!tasks.length) return 0;
    return Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
  }, [day]);

  async function refreshDay(nextDate = date) {
    setError("");
    const [configPayload, datesPayload, dayPayload] = await Promise.all([
      api<Config>("/api/config"),
      api<{ dates: string[] }>("/api/dates"),
      api<DayPayload>(`/api/day/${nextDate}`)
    ]);
    setConfig(configPayload);
    setDates(datesPayload.dates);
    setDay(dayPayload);
  }

  async function refreshWeek(nextDate = date) {
    setError("");
    const [weekPayload, messagesPayload] = await Promise.all([
      api<{ generated: string }>(`/api/week/${nextDate}`),
      api<{ messages: ChatMessage[] }>(`/api/week/${nextDate}/messages`)
    ]);
    setWeeklySummary(weekPayload.generated);
    setMessages(messagesPayload.messages);
  }

  useEffect(() => {
    refreshDay().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshDay(date).catch((err) => setError(err.message));
    if (view === "week") refreshWeek(date).catch((err) => setError(err.message));
  }, [date]);

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
      await refreshDay(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function generateWeek() {
    setBusy(true);
    setError("");
    try {
      const payload = await api<{ generated: string }>(`/api/week/${date}/summarize`, { method: "POST" });
      setWeeklySummary(payload.generated);
      await refreshWeek(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "周总结失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    if (!chatDraft.trim()) return;
    const content = chatDraft;
    setChatDraft("");
    setBusy(true);
    setError("");
    try {
      const payload = await api<{ messages: ChatMessage[] }>(`/api/week/${date}/chat`, {
        method: "POST",
        body: JSON.stringify({ content })
      });
      setMessages(payload.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
      setChatDraft(content);
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

        <div className="segmented">
          <button className={view === "day" ? "active" : ""} onClick={() => setView("day")}>
            <CalendarDays size={16} /> 当日
          </button>
          <button
            className={view === "week" ? "active" : ""}
            onClick={() => {
              setView("week");
              refreshWeek(date).catch((err) => setError(err.message));
            }}
          >
            <Bot size={16} /> 周总结
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
          <h2>已有 Markdown</h2>
          <div className="dateList">
            {dates.length ? (
              dates.map((item) => (
                <button key={item} className={item === date ? "current" : ""} onClick={() => setDate(item)}>
                  {item}
                </button>
              ))
            ) : (
              <p>还没有扫描到日期型 md 文件。</p>
            )}
          </div>
        </div>

        {config && (
          <div className="systemInfo">
            <p>
              <FileText size={14} /> {config.notesDir}
            </p>
            <p>
              <Database size={14} /> {config.dataPath}
            </p>
            <p>
              <Bot size={14} /> {config.llmEnabled ? "LLM 已启用" : "本地总结模式"}
            </p>
          </div>
        )}
      </aside>

      <section className="content">
        {error && <div className="error">{error}</div>}
        {view === "day" ? (
          <DayView
            date={date}
            day={day}
            completion={completion}
            summaryDraft={summaryDraft}
            setSummaryDraft={setSummaryDraft}
            saveSummary={saveSummary}
            busy={busy}
            refresh={() => refreshDay(date)}
          />
        ) : (
          <WeekView
            date={date}
            weeklySummary={weeklySummary}
            messages={messages}
            chatDraft={chatDraft}
            setChatDraft={setChatDraft}
            generateWeek={generateWeek}
            sendChat={sendChat}
            busy={busy}
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
  refresh: () => void;
  busy: boolean;
}) {
  const { date, day, completion, summaryDraft, setSummaryDraft, saveSummary, refresh, busy } = props;

  return (
    <div className="pageGrid">
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
        <p className="muted">完成度 {completion}%</p>

        <div className="taskList">
          {(day?.tasks || []).length ? (
            day?.tasks.map((task) => (
              <article key={task.id} className="taskRow">
                {task.completed ? <CheckCircle2 className="done" size={20} /> : <Circle className="todo" size={20} />}
                <div>
                  <p>{task.text}</p>
                  <span>
                    {task.file}:{task.line}
                  </span>
                </div>
              </article>
            ))
          ) : (
            <div className="emptyState">这一天没有解析到 Markdown checkbox 任务。</div>
          )}
        </div>

        <div className="notesPreview">
          <h3>Markdown 预览</h3>
          {(day?.notes || []).map((note) => (
            <article key={note.file} className="noteBlock">
              <header>
                <strong>{note.title}</strong>
                <span>{note.file}</span>
              </header>
              <div className="markdown" dangerouslySetInnerHTML={{ __html: note.html }} />
            </article>
          ))}
        </div>
      </section>

      <aside className="summaryPanel">
        <h3>当天小结</h3>
        <textarea
          value={summaryDraft}
          onChange={(event) => setSummaryDraft(event.target.value)}
          placeholder="记录今天推进了什么、卡住了什么、明天要保留的判断..."
        />
        <button className="primary" disabled={busy || !summaryDraft.trim()} onClick={saveSummary}>
          <Save size={16} /> 保存小结
        </button>

        <div className="summaryHistory">
          {(day?.summaries || []).map((summary) => (
            <article key={summary.id}>
              <time>{summary.createdAt}</time>
              <p>{summary.content}</p>
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function WeekView(props: {
  date: string;
  weeklySummary: string;
  messages: ChatMessage[];
  chatDraft: string;
  setChatDraft: (value: string) => void;
  generateWeek: () => void;
  sendChat: () => void;
  busy: boolean;
}) {
  const { date, weeklySummary, messages, chatDraft, setChatDraft, generateWeek, sendChat, busy } = props;
  return (
    <div className="weekGrid">
      <section className="mainPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Weekly synthesis</p>
            <h2>{date} 所在周</h2>
          </div>
          <button className="primary" onClick={generateWeek} disabled={busy}>
            <Sparkles size={16} /> 生成总结
          </button>
        </div>
        <pre className="weeklyText">{weeklySummary || "点击生成总结，或先保存一些当天小结。"}</pre>
      </section>

      <aside className="chatPanel">
        <div className="chatTitle">
          <MessageSquareText size={18} />
          <h3>本周语料对话</h3>
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
            placeholder="围绕这一周的任务和小结提问..."
          />
          <button aria-label="发送" onClick={sendChat} disabled={busy || !chatDraft.trim()}>
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
