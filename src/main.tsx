import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import MarkdownIt from "markdown-it";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  FileUp,
  Flame,
  Menu,
  MessageSquareText,
  Moon,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Sun,
  Trash2,
  X,
  Zap
} from "lucide-react";
import "./styles.css";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

type View = "day" | "preview" | "week" | "month";
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
  llmProvider: LlmProvider;
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
  streak: number;
};

type LlmStatus = {
  ok: boolean;
  message: string;
  model: string;
  settings?: LlmSettings;
};

type LlmProvider = "openai" | "anthropic";

type LlmSettings = {
  provider: LlmProvider;
  apiUrlMasked: string;
  apiKeyMasked: string;
  model: string;
  configured: boolean;
  ok: boolean;
  message: string;
};

type DocumentSummary = {
  id: number;
  filename: string;
  importedAt: string;
  dayCount: number;
  taskCount: number;
};

type DocumentPreview = {
  document: {
    id: number;
    filename: string;
    importedAt: string;
    html: string;
  };
  days: Array<{
    id: number;
    date: string;
    title: string;
    html: string;
  }>;
};

type Theme = "light" | "dark";

function formatDateLocal(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseNaturalDate(text: string): { date: string; text: string } {
  const trimmed = text.trim();
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const patterns: Array<{ regex: RegExp; getDate: (m: RegExpMatchArray) => Date }> = [
    { regex: /^今天\s+/, getDate: () => now },
    { regex: /^明天\s+/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) },
    { regex: /^后天\s+/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2) },
    { regex: /^大后天\s+/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3) },
    { regex: /^下周一日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (7 - mondayOffset)) },
    { regex: /^下周二日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (8 - mondayOffset)) },
    { regex: /^下周三日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (9 - mondayOffset)) },
    { regex: /^下周四日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (10 - mondayOffset)) },
    { regex: /^下周五日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (11 - mondayOffset)) },
    { regex: /^下周六日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (12 - mondayOffset)) },
    { regex: /^下周日日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + (13 - mondayOffset)) },
    { regex: /^周一日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((1 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周二日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((2 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周三日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((3 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周四周?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((4 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周五日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((5 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周六日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((6 - mondayOffset + 7) % 7 || 7)) },
    { regex: /^周日日?\s*/, getDate: () => new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - mondayOffset + 7) % 7 || 7)) }
  ];

  for (const { regex, getDate } of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      return { date: formatDateLocal(getDate(match)), text: trimmed.slice(match[0].length).trim() };
    }
  }

  const daysMatch = trimmed.match(/^(\d+)天后\s+/);
  if (daysMatch) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(daysMatch[1]));
    return { date: formatDateLocal(d), text: trimmed.slice(daysMatch[0].length).trim() };
  }

  const weeksMatch = trimmed.match(/^(\d+)周后\s+/);
  if (weeksMatch) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + Number(weeksMatch[1]) * 7);
    return { date: formatDateLocal(d), text: trimmed.slice(weeksMatch[0].length).trim() };
  }

  return { date: formatDateLocal(now), text: trimmed };
}

const today = formatDateLocal(new Date());

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
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day);
  next.setDate(next.getDate() + days);
  return formatDateLocal(next);
}

function scopeFromView(view: View): Scope {
  return view === "month" ? "month" : "week";
}

function rangeTitle(scope: Scope, date: string) {
  const current = new Date(`${date}T00:00:00`);
  const month = current.getMonth() + 1;
  if (scope === "month") return `${month}月`;

  const firstDay = new Date(current.getFullYear(), current.getMonth(), 1);
  const mondayBasedOffset = (firstDay.getDay() + 6) % 7;
  const weekOfMonth = Math.ceil((current.getDate() + mondayBasedOffset) / 7);
  return `${month}月第${weekOfMonth}周`;
}

function App() {
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState(today);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("theme") === "dark" ? "dark" : "light"));
  const [dates, setDates] = useState<string[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [progress, setProgress] = useState<Progress>({ total: 0, completed: 0, percent: 0, streak: 0 });
  const [llm, setLlm] = useState<LlmStatus>({ ok: false, message: "尚未检查", model: "gpt-4o-mini" });
  const [llmForm, setLlmForm] = useState({ provider: "openai" as LlmProvider, apiUrl: "", apiKey: "", model: "gpt-4o-mini" });
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [day, setDay] = useState<DayPayload | null>(null);
  const [manualTaskDraft, setManualTaskDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [rangeSummary, setRangeSummary] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [datesOpen, setDatesOpen] = useState(false);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [quickCaptureDraft, setQuickCaptureDraft] = useState("");

  const dayCompletion = useMemo(() => {
    const tasks = day?.tasks || [];
    if (!tasks.length) return 0;
    return Math.round((tasks.filter((task) => task.completed).length / tasks.length) * 100);
  }, [day]);

  const aiDisabled = !llm.ok || busy;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function refreshBase(nextDate = date) {
    const [configPayload, datesPayload, progressPayload, documentsPayload, dayPayload, llmPayload] = await Promise.all([
      api<Config>("/api/config"),
      api<{ dates: string[] }>("/api/dates"),
      api<Progress>("/api/progress"),
      api<{ documents: DocumentSummary[] }>("/api/documents"),
      api<DayPayload>(`/api/day/${nextDate}`),
      api<LlmStatus>("/api/llm/status")
    ]);
    setConfig(configPayload);
    setDates(datesPayload.dates);
    setProgress(progressPayload);
    setDocuments(documentsPayload.documents);
    if (!selectedDocumentId && documentsPayload.documents[0]) {
      setSelectedDocumentId(documentsPayload.documents[0].id);
    }
    setDay(dayPayload);
    setLlm(llmPayload);
    if (llmPayload.settings) {
      setLlmForm((current) => ({
        ...current,
        provider: llmPayload.settings?.provider || current.provider,
        model: llmPayload.settings?.model || current.model
      }));
    }
  }

  async function refreshDay(targetDate = date) {
    const [dayPayload, progressPayload] = await Promise.all([
      api<DayPayload>(`/api/day/${targetDate}`),
      api<Progress>("/api/progress")
    ]);
    setDay(dayPayload);
    setProgress(progressPayload);
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

  async function refreshPreview(documentId = selectedDocumentId) {
    if (!documentId) {
      setPreview(null);
      return;
    }
    const payload = await api<DocumentPreview>(`/api/documents/${documentId}/preview`);
    setPreview(payload);
    setSelectedDocumentId(documentId);
  }

  useEffect(() => {
    refreshBase().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setError("");
    refreshBase(date).catch((err) => setError(err.message));
    if (view === "week" || view === "month") refreshRange(date, view).catch((err) => setError(err.message));
  }, [date]);

  async function changeView(nextView: View) {
    setView(nextView);
    setError("");
    if (nextView === "week" || nextView === "month") {
      await refreshRange(date, nextView).catch((err) => setError(err.message));
    } else if (nextView === "preview") {
      await refreshPreview().catch((err) => setError(err.message));
    }
  }

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const content = await file.text();
      const payload = await api<{ documentId: number; duplicate: boolean; days: Array<{ date: string; taskCount: number }>; llmUsed?: boolean }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, content })
      });
      const firstDate = payload.days[0]?.date;
      if (firstDate) setDate(firstDate);
      setSelectedDocumentId(payload.documentId);
      const method = payload.llmUsed ? "AI 智能解析" : "正则解析";
      setNotice(payload.duplicate ? "这个 Markdown 文件已经导入过。" : `导入完成（${method}）：切分 ${payload.days.length} 天。`);
      await refreshBase(firstDate || date);
      await refreshPreview(payload.documentId);
      setView("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDocument(document: DocumentSummary) {
    const confirmed = window.confirm(`删除 ${document.filename}？这会同时删除它导入的任务和 Markdown 预览。`);
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(`/api/documents/${document.id}`, { method: "DELETE" });
      if (selectedDocumentId === document.id) {
        setSelectedDocumentId(null);
        setPreview(null);
      }
      setNotice(`已删除 ${document.filename}`);
      await refreshBase(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
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

  async function addManualTask(targetDate?: string, targetText?: string) {
    const d = targetDate || date;
    const text = (targetText || manualTaskDraft).trim();
    if (!text) return;
    setError("");
    try {
      await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ date: d, text })
      });
      if (!targetText) setManualTaskDraft("");
      await refreshDay(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加任务失败");
    }
  }

  async function saveSummary() {
    if (!summaryDraft.trim()) return;
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
    }
  }

  async function deleteTask(taskId: string) {
    setError("");
    const previous = day;
    setDay((current) =>
      current ? { ...current, tasks: current.tasks.filter((t) => t.id !== taskId) } : current
    );
    try {
      await api(`/api/tasks/${taskId}`, { method: "DELETE" });
      const progressPayload = await api<Progress>("/api/progress");
      setProgress(progressPayload);
    } catch (err) {
      setDay(previous);
      setError(err instanceof Error ? err.message : "删除任务失败");
    }
  }

  async function generateDailyReview() {
    setBusy(true);
    setError("");
    try {
      const payload = await api<{ generated: string }>(`/api/day/${date}/review`, { method: "POST" });
      setSummaryDraft(payload.generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 回顾生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickCapture() {
    const lines = quickCaptureDraft.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setError("");
    try {
      for (const line of lines) {
        const parsed = parseNaturalDate(line);
        if (parsed.text) {
          await api("/api/tasks", { method: "POST", body: JSON.stringify({ date: parsed.date, text: parsed.text }) });
        }
      }
      setQuickCaptureDraft("");
      setQuickCaptureOpen(false);
      setNotice(`已添加 ${lines.length} 条任务`);
      await refreshDay(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "快速添加失败");
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        if (quickCaptureOpen) { setQuickCaptureOpen(false); return; }
        if (error) { setError(""); return; }
        if (notice) { setNotice(""); return; }
        return;
      }

      if (isInput) return;

      if (e.key === "n" || e.key === "N") { e.preventDefault(); setQuickCaptureOpen(true); return; }
      if (e.key === "j") { e.preventDefault(); setDate(shiftDate(date, 1)); return; }
      if (e.key === "k") { e.preventDefault(); setDate(shiftDate(date, -1)); return; }
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setTheme((t) => (t === "light" ? "dark" : "light")); return; }
      if (e.key === "1") { e.preventDefault(); changeView("day"); return; }
      if (e.key === "2") { e.preventDefault(); changeView("preview"); return; }
      if (e.key === "3") { e.preventDefault(); changeView("week"); return; }
      if (e.key === "4") { e.preventDefault(); changeView("month"); return; }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [quickCaptureOpen, error, notice, date, view]);

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

  async function saveLlmSettings() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = {
        provider: llmForm.provider,
        model: llmForm.model,
        ...(llmForm.apiUrl.trim() ? { apiUrl: llmForm.apiUrl.trim() } : {}),
        ...(llmForm.apiKey.trim() ? { apiKey: llmForm.apiKey.trim() } : {})
      };
      const payload = await api<LlmStatus>("/api/llm/settings", {
        method: "POST",
        body: JSON.stringify(body)
      });
      setLlmForm((current) => ({ ...current, apiUrl: "", apiKey: "" }));
      if (payload.settings?.configured) {
        const checked = await api<LlmStatus>("/api/llm/check", { method: "POST" });
        setLlm(checked);
        setNotice(checked.ok ? "API 配置已保存，大模型检查通过。" : "API 配置已保存，但大模型检查失败。");
      } else {
        setLlm(payload);
        setNotice("API 配置已保存，请补全 API Key 和模型名称。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存 API 配置失败");
    } finally {
      setBusy(false);
    }
  }

  async function clearLlmSettings() {
    const confirmed = window.confirm("清空当前大模型 API 配置？");
    if (!confirmed) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload = await api<LlmStatus>("/api/llm/settings", { method: "DELETE" });
      setLlm(payload);
      setLlmForm({ provider: "openai", apiUrl: "", apiKey: "", model: "gpt-4o-mini" });
      setNotice("API 配置已清空。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空 API 配置失败");
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
      {quickCaptureOpen && (
        <div className="quickCaptureOverlay" onClick={() => setQuickCaptureOpen(false)}>
          <div className="quickCapturePanel" onClick={(e) => e.stopPropagation()}>
            <div className="quickCaptureHeader">
              <Zap size={18} />
              <h3>快速捕获</h3>
              <button className="quickCaptureClose" onClick={() => setQuickCaptureOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <textarea
              className="quickCaptureInput"
              value={quickCaptureDraft}
              onChange={(e) => setQuickCaptureDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleQuickCapture(); }
                if (e.key === "Escape") setQuickCaptureOpen(false);
              }}
              placeholder={"每行一条任务，支持日期前缀：\n明天 写周报\n后天 整理文档\n提交PR"}
              autoFocus
            />
            <div className="quickCaptureFooter">
              <span>支持 "明天/后天/周X 任务名" 格式 · Enter 添加 · Shift+Enter 换行</span>
              <button className="primary" onClick={handleQuickCapture} disabled={!quickCaptureDraft.trim()}>
                添加
              </button>
            </div>
          </div>
        </div>
      )}

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
          <div className="progressMeta">
            <p>{progress.completed}/{progress.total} 已完成</p>
            {progress.streak > 0 && (
              <p className="streakBadge"><Flame size={14} /> 连续 {progress.streak} 天</p>
            )}
          </div>
        </div>

        <div className="segmented four">
          <button className={view === "day" ? "active" : ""} onClick={() => changeView("day")}>
            <CalendarDays size={16} /> 当日
          </button>
          <button className={view === "preview" ? "active" : ""} onClick={() => changeView("preview")}>
            <FileText size={16} /> 预览
          </button>
          <button className={view === "week" ? "active" : ""} onClick={() => changeView("week")}>
            <Bot size={16} /> 周
          </button>
          <button className={view === "month" ? "active" : ""} onClick={() => changeView("month")}>
            <Bot size={16} /> 月
          </button>
        </div>

        <details className="functionMenu">
          <summary>
            <Menu size={17} />
            <span>功能菜单</span>
          </summary>

          <div className="menuBody">
            <div className="themeSwitch">
              <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")}>
                <Sun size={15} /> 日间
              </button>
              <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")}>
                <Moon size={15} /> 夜间
              </button>
            </div>

            <label className="uploadBox">
              <FileUp size={18} />
              <span>提交 Markdown 文件</span>
              <input type="file" accept=".md,text/markdown,text/plain" onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
            </label>

            <div className="documentList">
              <h2>已导入文件</h2>
              {documents.length ? (
                documents.map((document) => (
                  <div key={document.id} className={document.id === selectedDocumentId ? "documentRow current" : "documentRow"}>
                    <button
                      className="documentOpen"
                      onClick={() => {
                        setView("preview");
                        refreshPreview(document.id).catch((err) => setError(err.message));
                      }}
                    >
                      <span>{document.filename}</span>
                      <small>
                        {document.dayCount} 天 · {document.taskCount} 任务
                      </small>
                    </button>
                    <button className="deleteButton" aria-label={`删除 ${document.filename}`} onClick={() => deleteDocument(document)} disabled={busy}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <p>还没有导入文件。</p>
              )}
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
              <button className="dateToggle" onClick={() => setDatesOpen((open) => !open)}>
                {dates.length ? `${date} · ${dates.length} 天` : "还没有导入日期"}
              </button>
              {datesOpen && (
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
              )}
            </div>

            <div className={`llmStatus ${llm.ok ? "ok" : "fail"}`}>
              <div>
                <Bot size={15} />
                <span>{llm.ok ? "LLM 可用" : "LLM 不可用"}</span>
              </div>
              <p>{llm.message}</p>
              <div className="llmForm">
                <select
                  value={llmForm.provider}
                  onChange={(event) => {
                    const provider = event.target.value as LlmProvider;
                    setLlmForm((current) => ({
                      ...current,
                      provider,
                      model: provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"
                    }));
                  }}
                >
                  <option value="openai">OpenAI 协议</option>
                  <option value="anthropic">Anthropic 协议</option>
                </select>
                <input
                  type="password"
                  value={llmForm.apiUrl}
                  placeholder={llm.settings?.apiUrlMasked || (llmForm.provider === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")}
                  onChange={(event) => setLlmForm((current) => ({ ...current, apiUrl: event.target.value }))}
                />
                <input
                  type="password"
                  value={llmForm.apiKey}
                  placeholder={llm.settings?.apiKeyMasked || "API Key"}
                  onChange={(event) => setLlmForm((current) => ({ ...current, apiKey: event.target.value }))}
                />
                <input
                  value={llmForm.model}
                  placeholder="模型名称"
                  onChange={(event) => setLlmForm((current) => ({ ...current, model: event.target.value }))}
                />
              </div>
              <button className="iconText" onClick={saveLlmSettings} disabled={busy}>
                <Save size={15} /> 保存配置
              </button>
              <button className="iconText dangerText" onClick={clearLlmSettings} disabled={busy}>
                <Trash2 size={15} /> 清空配置
              </button>
              {!llm.settings?.configured && (
                <button className="iconText" onClick={checkLlm} disabled={busy}>
                  <RefreshCw size={15} /> 检查大模型
                </button>
              )}
            </div>
          </div>
        </details>

        {config && (
          <div className="systemInfo">
            <p>
              <Bot size={14} /> {llm.model || config.llmModel}
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
            deleteTask={deleteTask}
            manualTaskDraft={manualTaskDraft}
            setManualTaskDraft={setManualTaskDraft}
            addManualTask={() => addManualTask()}
            busy={busy}
            refresh={() => refreshDay(date)}
            aiAvailable={llm.ok}
            generateDailyReview={generateDailyReview}
          />
        ) : view === "preview" ? (
          <PreviewView preview={preview} documents={documents} refreshPreview={refreshPreview} />
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
  deleteTask: (taskId: string) => void;
  manualTaskDraft: string;
  setManualTaskDraft: (value: string) => void;
  addManualTask: () => void;
  refresh: () => void;
  busy: boolean;
  aiAvailable: boolean;
  generateDailyReview: () => void;
}) {
  const {
    date,
    day,
    completion,
    summaryDraft,
    setSummaryDraft,
    saveSummary,
    toggleTask,
    deleteTask,
    manualTaskDraft,
    setManualTaskDraft,
    addManualTask,
    refresh,
    busy,
    aiAvailable,
    generateDailyReview
  } = props;

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

        <div className="manualTaskBox">
          <input
            value={manualTaskDraft}
            onChange={(event) => setManualTaskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addManualTask();
            }}
            placeholder="手动添加一条清单任务..."
          />
          <button className="primary" disabled={!manualTaskDraft.trim()} onClick={addManualTask}>
            添加
          </button>
        </div>

        <div className="taskList">
          {(day?.tasks || []).length ? (
            day?.tasks.map((task) => (
              <div key={task.id} className="taskRow">
                <button className="taskToggle" onClick={() => toggleTask(task)}>
                  {task.completed ? <CheckCircle2 className="done" size={20} /> : <Circle className="todo" size={20} />}
                </button>
                <div className="taskText">
                  <p>{task.text}</p>
                </div>
                <button className="taskDelete" onClick={() => deleteTask(task.id)} aria-label="删除任务">
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="emptyState">这一天还没有任务。</div>
          )}
        </div>

        <div className="dailySummaryBottom">
          <div className="summaryHeader">
            <h3>当天总结</h3>
            {aiAvailable && (
              <button className="iconText" onClick={generateDailyReview} disabled={busy}>
                <Sparkles size={14} /> AI 回顾
              </button>
            )}
          </div>
          <textarea
            value={summaryDraft}
            onChange={(event) => setSummaryDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") saveSummary();
            }}
            placeholder="记录今天推进了什么、卡住了什么、明天要保留的判断..."
          />
          <button className="primary" disabled={!summaryDraft.trim()} onClick={saveSummary}>
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

function PreviewView(props: {
  preview: DocumentPreview | null;
  documents: DocumentSummary[];
  refreshPreview: (documentId?: number | null) => Promise<void>;
}) {
  const { preview, documents, refreshPreview } = props;
  return (
    <div className="singleColumn">
      <section className="mainPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">Markdown preview</p>
            <h2>{preview?.document.filename || "Markdown 预览"}</h2>
          </div>
          <button className="iconText" onClick={() => refreshPreview()}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>

        {preview ? (
          <div className="previewStack">
            {preview.days.map((day) => (
              <article key={day.id} className="previewDay">
                <header>
                  <span>{day.date}</span>
                  <strong>{day.title}</strong>
                </header>
                <div className="markdown readableMarkdown" dangerouslySetInnerHTML={{ __html: day.html }} />
              </article>
            ))}
          </div>
        ) : documents.length ? (
          <div className="emptyState">从左侧选择一个 Markdown 文件查看预览。</div>
        ) : (
          <div className="emptyState">还没有导入 Markdown 文件。</div>
        )}
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
  const title = rangeTitle(scope, date);
  const summaryHtml = useMemo(() => (summary ? md.render(summary) : ""), [summary]);

  return (
    <div className="weekGrid">
      <section className="mainPanel">
        <div className="panelHeader">
          <div>
            <p className="eyebrow">{scope === "month" ? "Monthly synthesis" : "Weekly synthesis"}</p>
            <h2>{title}</h2>
          </div>
          <button className="primary" onClick={generateRange} disabled={aiDisabled}>
            <Sparkles size={16} /> 生成{label}
          </button>
        </div>
        {summaryHtml ? (
          <div className="weeklyRendered markdown readableMarkdown" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
        ) : (
          <pre className="weeklyText">{`切到${label}后会显示当前范围的本地语料概览。`}</pre>
        )}
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
                <div dangerouslySetInnerHTML={{ __html: md.render(message.content) }} />
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(); }
            }}
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
