import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import "dotenv/config";
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek
} from "date-fns";
import express from "express";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const app = express();
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });

const LLM_PARSE_SYSTEM_PROMPT = [
  "你是一个 Markdown 日记/任务文件解析器。用户会给你一段 Markdown 文本，你需要：",
  "1. 识别其中按日期分组的结构。常见的日期标识包括：",
  '   - 标题中包含日期，如 "### Day 2026-06-01"、"## 6月1日"、"# 2026/06/01"',
  '   - 标题中包含"第X天"、"Day X"等相对日期描述',
  "   - frontmatter 中的 date 字段",
  "   - 文件名中的日期",
  "2. 提取每天的任务项，包括：",
  "   - checkbox 任务：- [ ] 未完成，- [x] 已完成",
  "   - 子标题（####、#####、######）作为任务项",
  "   - 其他有明确动作描述的条目",
  "3. 如果无法识别按日期分组的结构，将全部内容归为一天。",
  "你必须只返回一个 JSON 对象，不要返回任何其他文字、不要使用 markdown code fence。格式如下：",
  '{"days":[{"date":"YYYY-MM-DD","title":"标题","tasks":[{"text":"任务描述","completed":false}]}]}'
].join("\n");
const rootDir = process.cwd();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const dbPath = path.join(dataDir, "app.db");
const port = Number(process.env.PORT || 4317);

fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
  create table if not exists imported_documents (
    id integer primary key autoincrement,
    filename text not null,
    content text not null,
    content_hash text not null unique,
    imported_at text not null default (datetime('now'))
  );

  create table if not exists day_notes (
    id integer primary key autoincrement,
    document_id integer not null,
    date text not null,
    title text not null,
    content text not null,
    created_at text not null default (datetime('now')),
    foreign key (document_id) references imported_documents(id) on delete cascade
  );

  create table if not exists tasks (
    id text primary key,
    document_id integer not null,
    day_note_id integer not null,
    date text not null,
    line integer not null,
    text text not null,
    completed integer not null default 0,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now')),
    foreign key (document_id) references imported_documents(id) on delete cascade,
    foreign key (day_note_id) references day_notes(id) on delete cascade
  );

  create table if not exists daily_summaries (
    id integer primary key autoincrement,
    date text not null,
    content text not null,
    created_at text not null default (datetime('now')),
    updated_at text not null default (datetime('now'))
  );

  create table if not exists chat_messages (
    id integer primary key autoincrement,
    week_start text not null,
    role text not null,
    content text not null,
    created_at text not null default (datetime('now'))
  );

  create table if not exists llm_settings (
    id integer primary key check (id = 1),
    provider text not null default 'openai',
    api_url text not null default '',
    api_key text not null default '',
    model text not null default 'gpt-4o-mini',
    checked_ok integer not null default 0,
    last_message text not null default '尚未检查',
    updated_at text not null default (datetime('now'))
  );
`);

const chatColumns = db.prepare("pragma table_info(chat_messages)").all().map((column) => column.name);
if (!chatColumns.includes("scope_type")) {
  db.exec("alter table chat_messages add column scope_type text not null default 'week'");
}
if (!chatColumns.includes("scope_start")) {
  db.exec("alter table chat_messages add column scope_start text");
  db.exec("update chat_messages set scope_start = week_start where scope_start is null");
}

db.prepare(
  `insert or ignore into llm_settings (id, provider, api_url, api_key, model, checked_ok, last_message)
   values (1, 'openai', '', '', 'gpt-4o-mini', 0, '尚未配置')`
).run();

app.use(express.json({ limit: "10mb" }));

function validateDate(input) {
  const parsed = parseISO(String(input || ""));
  if (!isValid(parsed)) return null;
  return format(parsed, "yyyy-MM-dd");
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function dateFromFilename(filename) {
  return path.basename(filename).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || null;
}

function dateFromFrontmatter(filename, data) {
  const date = validateDate(data.date);
  return date || dateFromFilename(filename);
}

function splitMarkdownByDate(filename, raw) {
  const parsed = matter(raw);
  const frontmatterDate = dateFromFrontmatter(filename, parsed.data);
  const lines = parsed.content.split(/\r?\n/);
  const dayHeadingIndexes = [];
  const startDate = frontmatterDate || dateFromFilename(filename) || format(new Date(), "yyyy-MM-dd");

  lines.forEach((line, index) => {
    const match = line.match(/^\s{0,3}###\s+(Day\b.*)$/i);
    if (match) {
      const dateInTitle = validateDate(match[1].match(/(\d{4}-\d{2}-\d{2})/)?.[1]);
      dayHeadingIndexes.push({
        index,
        date: dateInTitle,
        title: match[1].trim()
      });
    }
  });

  if (dayHeadingIndexes.length) {
    return dayHeadingIndexes.map((item, index) => {
      const next = dayHeadingIndexes[index + 1]?.index ?? lines.length;
      const date = item.date || format(addDays(parseISO(startDate), index), "yyyy-MM-dd");
      return {
        date,
        title: item.title || `${filename} ${date}`,
        content: lines.slice(item.index, next).join("\n").trim(),
        taskEnabled: true
      };
    });
  }

  const fallbackDate = frontmatterDate || format(new Date(), "yyyy-MM-dd");
  return [
    {
      date: fallbackDate,
      title: parsed.data.title || path.basename(filename, ".md"),
      content: parsed.content.trim(),
      taskEnabled: false
    }
  ];
}

function parseTasks(content, documentId, dayNoteId, date) {
  return content
    .split(/\r?\n/)
    .map((line, index) => {
      const checkboxMatch = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/);
      const subheadingMatch = line.match(/^\s{0,3}#{4,6}\s+(.+?)\s*$/);
      if (!checkboxMatch && !subheadingMatch) return null;
      const text = (checkboxMatch?.[2] || subheadingMatch?.[1] || "").trim();
      return {
        id: hashText(`${documentId}:${dayNoteId}:${date}:${index + 1}:${text}`),
        documentId,
        dayNoteId,
        date,
        line: index + 1,
        text,
        completed: checkboxMatch?.[1].toLowerCase() === "x" ? 1 : 0
      };
    })
    .filter(Boolean);
}

async function importMarkdown(filename, content) {
  const hash = hashText(content);
  const existing = db.prepare("select id from imported_documents where content_hash = ?").get(hash);
  if (existing) return { documentId: existing.id, duplicate: true, days: [] };

  const insertDocument = db.prepare("insert into imported_documents (filename, content, content_hash) values (?, ?, ?)");
  const insertDay = db.prepare("insert into day_notes (document_id, date, title, content) values (?, ?, ?, ?)");
  const insertTask = db.prepare(`
    insert into tasks (id, document_id, day_note_id, date, line, text, completed)
    values (@id, @documentId, @dayNoteId, @date, @line, @text, @completed)
  `);

  let parsedDays;
  let llmUsed = false;
  if (hasLlmConfig()) {
    try {
      const llmDays = await callLlmForParse(filename, content);
      parsedDays = llmDays.map((day) => ({
        date: day.date,
        title: day.title,
        content: day.content || day.tasks.map((t) => (t.completed ? `- [x] ${t.text}` : `- [ ] ${t.text}`)).join("\n"),
        taskEnabled: true,
        llmTasks: day.tasks
      }));
      llmUsed = true;
    } catch (err) {
      console.warn(`LLM parse failed for ${filename}, falling back to regex:`, err.message);
      parsedDays = splitMarkdownByDate(filename, content);
    }
  } else {
    parsedDays = splitMarkdownByDate(filename, content);
  }

  return db.transaction(() => {
    const documentId = Number(insertDocument.run(filename, content, hash).lastInsertRowid);
    const days = parsedDays.map((day) => {
      const dayNoteId = Number(insertDay.run(documentId, day.date, day.title, day.content).lastInsertRowid);
      let tasks;
      if (llmUsed && day.llmTasks) {
        tasks = day.llmTasks.map((t, index) => ({
          id: hashText(`${documentId}:${dayNoteId}:${day.date}:${index + 1}:${t.text}`),
          documentId,
          dayNoteId,
          date: day.date,
          line: index + 1,
          text: t.text,
          completed: t.completed ? 1 : 0
        }));
      } else {
        tasks = day.taskEnabled ? parseTasks(day.content, documentId, dayNoteId, day.date) : [];
      }
      tasks.forEach((task) => insertTask.run(task));
      return { date: day.date, title: day.title, id: dayNoteId, taskCount: tasks.length };
    });
    return { documentId, duplicate: false, days, llmUsed };
  })();
}

function getManualDocumentId() {
  const filename = "__manual_tasks__.md";
  const existing = db.prepare("select id from imported_documents where filename = ?").get(filename);
  if (existing) return existing.id;
  return Number(
    db.prepare("insert into imported_documents (filename, content, content_hash) values (?, ?, ?)")
      .run(filename, "Manual tasks created in Taw Knows.", "__manual_tasks__")
      .lastInsertRowid
  );
}

function getManualDayNoteId(documentId, date) {
  const existing = db.prepare("select id from day_notes where document_id = ? and date = ?").get(documentId, date);
  if (existing) return existing.id;
  return Number(
    db.prepare("insert into day_notes (document_id, date, title, content) values (?, ?, ?, ?)")
      .run(documentId, date, `手动任务 ${date}`, `### Day ${date}\n`)
      .lastInsertRowid
  );
}

function createManualTask(date, text) {
  const documentId = getManualDocumentId();
  const dayNoteId = getManualDayNoteId(documentId, date);
  const line = Number(db.prepare("select count(*) as count from tasks where day_note_id = ?").get(dayNoteId).count) + 1;
  const id = hashText(`manual:${documentId}:${dayNoteId}:${date}:${Date.now()}:${text}`);
  db.prepare(
    `insert into tasks (id, document_id, day_note_id, date, line, text, completed)
     values (?, ?, ?, ?, ?, ?, 0)`
  ).run(id, documentId, dayNoteId, date, line, text);
  return taskRows("where tasks.id = ?", [id])[0];
}

function taskRows(where = "", params = []) {
  return db
    .prepare(
      `
      select
        tasks.id,
        tasks.date,
        imported_documents.filename as file,
        tasks.line,
        tasks.text,
        tasks.completed
      from tasks
      join imported_documents on imported_documents.id = tasks.document_id
      ${where}
      order by tasks.date asc, tasks.line asc
    `
    )
    .all(...params)
    .map((task) => ({ ...task, completed: Boolean(task.completed) }));
}

function getSummariesBetween(start, end) {
  return db
    .prepare(
      "select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where date between ? and ? order by date asc, id asc"
    )
    .all(start, end);
}

function boundsFor(scope, date) {
  const parsed = parseISO(date);
  const start = scope === "month" ? startOfMonth(parsed) : startOfWeek(parsed, { weekStartsOn: 1 });
  const end = scope === "month" ? endOfMonth(parsed) : endOfWeek(parsed, { weekStartsOn: 1 });
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

function buildCorpus(scope, date) {
  const { start, end } = boundsFor(scope, date);
  const tasks = taskRows("where tasks.date between ? and ?", [start, end]);
  const summaries = getSummariesBetween(start, end);
  return { scope, start, end, tasks, summaries };
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 8) return "********";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

function getLlmSettings() {
  return db.prepare("select provider, api_url as apiUrl, api_key as apiKey, model, checked_ok as checkedOk, last_message as lastMessage from llm_settings where id = 1").get();
}

function publicLlmSettings(settings = getLlmSettings()) {
  const configured = Boolean(settings.apiKey && settings.model);
  return {
    provider: settings.provider,
    apiUrlMasked: maskSecret(settings.apiUrl),
    apiKeyMasked: maskSecret(settings.apiKey),
    model: settings.model,
    configured,
    ok: configured && Boolean(settings.checkedOk),
    message: settings.lastMessage || "尚未检查"
  };
}

function normalizeApiUrl(provider, apiUrl) {
  const trimmed = String(apiUrl || "").trim();
  if (provider === "anthropic") {
    const base = trimmed || "https://api.anthropic.com/v1/messages";
    if (base.endsWith("/messages")) return base;
    return `${base.replace(/\/$/, "")}/messages`;
  }

  const base = trimmed || "https://api.openai.com/v1/chat/completions";
  if (base.endsWith("/chat/completions")) return base;
  return `${base.replace(/\/$/, "")}/chat/completions`;
}

function hasLlmConfig() {
  const settings = getLlmSettings();
  return Boolean(settings.apiKey && settings.model && settings.checkedOk);
}

async function callOpenAiCompatible(settings, messages) {
  const response = await fetch(normalizeApiUrl("openai", settings.apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI-compatible API request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI-compatible API returned an empty response");
  return content;
}

async function callAnthropicCompatible(settings, messages) {
  const system = messages.find((message) => message.role === "system")?.content;
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content)
    }));

  const response = await fetch(normalizeApiUrl("anthropic", settings.apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 1600,
      system,
      messages: anthropicMessages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic-compatible API request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  const content = data.content?.map((part) => part.text || "").join("").trim();
  if (!content) throw new Error("Anthropic-compatible API returned an empty response");
  return content;
}

async function callLlm(messages) {
  const settings = getLlmSettings();
  if (!settings.apiKey) throw new Error("页面中尚未配置 API Key");
  if (!settings.model) throw new Error("页面中尚未配置模型名称");
  const content =
    settings.provider === "anthropic"
      ? await callAnthropicCompatible(settings, messages)
      : await callOpenAiCompatible(settings, messages);
  return content;
}

async function callLlmForParse(filename, content) {
  const fallbackDate = dateFromFilename(filename) || format(new Date(), "yyyy-MM-dd");
  const userMessage = `文件名：${filename}\n\n---\n\n${content}`;
  const raw = await callLlm([
    { role: "system", content: LLM_PARSE_SYSTEM_PROMPT },
    { role: "user", content: userMessage }
  ]);
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed.days || !Array.isArray(parsed.days)) throw new Error("LLM 返回结构缺少 days 数组");
  return parsed.days.map((day, index) => ({
    date: validateDate(day.date) || format(addDays(parseISO(fallbackDate), index), "yyyy-MM-dd"),
    title: String(day.title || `Day ${index + 1}`),
    content: String(day.content || ""),
    tasks: Array.isArray(day.tasks)
      ? day.tasks
          .map((t) => ({ text: String(t.text || "").trim(), completed: Boolean(t.completed) }))
          .filter((t) => t.text)
      : []
  }));
}

async function checkLlm() {
  const settings = getLlmSettings();
  if (!settings.apiKey || !settings.model) {
    const message = "请先在页面中配置 API Key 和模型名称";
    db.prepare("update llm_settings set checked_ok = 0, last_message = ?, updated_at = datetime('now') where id = 1").run(message);
    return { ok: false, message, model: settings.model || "未配置", settings: publicLlmSettings(getLlmSettings()) };
  }
  try {
    await callLlm([{ role: "user", content: "请只回复：ok" }]);
    const message = "大模型 API 检查通过";
    db.prepare("update llm_settings set checked_ok = 1, last_message = ?, updated_at = datetime('now') where id = 1").run(message);
    return { ok: true, message, model: settings.model, settings: publicLlmSettings(getLlmSettings()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "大模型 API 检查失败";
    db.prepare("update llm_settings set checked_ok = 0, last_message = ?, updated_at = datetime('now') where id = 1").run(message);
    return { ok: false, message, model: settings.model, settings: publicLlmSettings(getLlmSettings()) };
  }
}

function messagesFor(scope, scopeStart) {
  return db
    .prepare(
      `select id, scope_type as scopeType, scope_start as scopeStart, role, content, created_at as createdAt
       from chat_messages
       where scope_type = ? and scope_start = ?
       order by id asc`
    )
    .all(scope, scopeStart);
}

app.get("/api/config", (_req, res) => {
  const llm = publicLlmSettings();
  res.json({
    dataPath: dbPath,
    llmConfigured: llm.configured,
    llmModel: llm.model,
    llmProvider: llm.provider
  });
});

app.get("/api/dates", (_req, res) => {
  const dates = db.prepare("select distinct date from day_notes order by date asc").all().map((row) => row.date);
  res.json({ dates });
});

app.get("/api/progress", (_req, res) => {
  const row = db
    .prepare("select count(*) as total, sum(case when completed = 1 then 1 else 0 end) as completed from tasks")
    .get();
  const total = Number(row.total || 0);
  const completed = Number(row.completed || 0);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const completedDates = db
    .prepare("select distinct date from tasks where completed = 1 order by date desc")
    .all()
    .map((r) => r.date);
  let streak = 0;
  let checkDate = parseISO(todayStr);
  for (const d of completedDates) {
    const expected = format(checkDate, "yyyy-MM-dd");
    if (d === expected) {
      streak++;
      checkDate = addDays(checkDate, -1);
    } else if (d < expected) {
      break;
    }
  }

  res.json({ total, completed, percent: total ? Math.round((completed / total) * 100) : 0, streak });
});

app.get("/api/documents", (_req, res) => {
  const documents = db
    .prepare(
      `select
        imported_documents.id,
        imported_documents.filename,
        imported_documents.imported_at as importedAt,
        count(distinct day_notes.id) as dayCount,
        count(tasks.id) as taskCount
      from imported_documents
      left join day_notes on day_notes.document_id = imported_documents.id
      left join tasks on tasks.document_id = imported_documents.id
      where imported_documents.filename != '__manual_tasks__.md'
      group by imported_documents.id
      order by imported_documents.imported_at desc, imported_documents.id desc`
    )
    .all();
  res.json({ documents });
});

app.post("/api/import", async (req, res) => {
  const filename = String(req.body.filename || "uploaded.md").trim();
  const content = String(req.body.content || "");
  if (!filename.toLowerCase().endsWith(".md")) return res.status(400).json({ error: "Only .md files are supported" });
  if (!content.trim()) return res.status(400).json({ error: "Markdown content is required" });
  try {
    const result = await importMarkdown(filename, content);
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
});

app.get("/api/documents/:id/preview", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid document id" });
  const document = db
    .prepare("select id, filename, content, imported_at as importedAt from imported_documents where id = ?")
    .get(id);
  if (!document) return res.status(404).json({ error: "Document not found" });
  const days = db
    .prepare("select id, date, title, content from day_notes where document_id = ? order by date asc, id asc")
    .all(id)
    .map((day) => ({ ...day, html: markdown.render(day.content) }));
  res.json({ document: { ...document, html: markdown.render(document.content) }, days });
});

app.delete("/api/documents/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid document id" });
  const existing = db.prepare("select id from imported_documents where id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Document not found" });
  db.transaction(() => {
    const dates = db.prepare("select distinct date from day_notes where document_id = ?").all(id).map((row) => row.date);
    db.prepare("delete from tasks where document_id = ?").run(id);
    db.prepare("delete from day_notes where document_id = ?").run(id);
    db.prepare("delete from imported_documents where id = ?").run(id);
    // Clean up summaries for dates that no longer have any day_notes
    for (const date of dates) {
      const hasOtherNotes = db.prepare("select 1 from day_notes where date = ? limit 1").get(date);
      if (!hasOtherNotes) {
        db.prepare("delete from daily_summaries where date = ?").run(date);
      }
    }
    // Also clean up any orphaned summaries (dates with no remaining day_notes at all)
    db.prepare(
      "delete from daily_summaries where date not in (select distinct date from day_notes)"
    ).run();
    // Clean up chat messages for empty scopes
    db.prepare(
      "delete from chat_messages where scope_start not in (select distinct date from day_notes)"
    ).run();
  })();
  res.json({ ok: true });
});

app.delete("/api/data/all", (_req, res) => {
  db.transaction(() => {
    db.prepare("delete from tasks").run();
    db.prepare("delete from day_notes").run();
    db.prepare("delete from daily_summaries").run();
    db.prepare("delete from chat_messages").run();
    db.prepare("delete from imported_documents").run();
  })();
  res.json({ ok: true });
});

app.get("/api/day/:date", (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });

  const notes = db
    .prepare(
      `select day_notes.id, day_notes.date, imported_documents.filename as file, day_notes.title, day_notes.content
       from day_notes
       join imported_documents on imported_documents.id = day_notes.document_id
       where day_notes.date = ?
       order by day_notes.id asc`
    )
    .all(date)
    .map((note) => ({ ...note, html: markdown.render(note.content), tasks: [] }));
  const tasks = taskRows("where tasks.date = ?", [date]);
  const summaries = db
    .prepare(
      "select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where date = ? order by id desc"
    )
    .all(date);

  res.json({ date, notes, tasks, summaries });
});

app.post("/api/day/:date/review", async (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!hasLlmConfig()) return res.status(503).json({ error: "LLM is not configured" });

  const tasks = taskRows("where tasks.date = ?", [date]);
  const summaries = db
    .prepare("select content from daily_summaries where date = ? order by id desc")
    .all(date)
    .map((s) => s.content);

  const prompt = [
    "你是用户的每日复盘助手。根据今天的任务完成情况和已有小结，生成一份简洁的每日回顾。",
    `日期：${date}`,
    `任务：${JSON.stringify(tasks.map((t) => ({ text: t.text, completed: t.completed })), null, 2)}`,
    `已有小结：${summaries.length ? summaries.join("\n---\n") : "无"}`,
    "请用中文输出，格式如下（不要多余解释）：",
    "## 今日完成\n- [列出已完成的任务]\n\n## 待推进\n- [列出未完成的任务]\n\n## 明日建议\n- [基于未完成任务给出 1-3 条建议]"
  ].join("\n\n");

  try {
    const generated = await callLlm([{ role: "user", content: prompt }]);
    res.json({ generated, date });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "AI review failed" });
  }
});

app.patch("/api/tasks/:id", (req, res) => {
  const id = String(req.params.id || "");
  const completed = Boolean(req.body.completed);
  const info = db
    .prepare("update tasks set completed = ?, updated_at = datetime('now') where id = ?")
    .run(completed ? 1 : 0, id);
  if (!info.changes) return res.status(404).json({ error: "Task not found" });
  const task = taskRows("where tasks.id = ?", [id])[0];
  res.json({ task });
});

app.delete("/api/tasks/:id", (req, res) => {
  const id = String(req.params.id || "");
  const info = db.prepare("delete from tasks where id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: "Task not found" });
  res.json({ ok: true });
});

app.post("/api/tasks", (req, res) => {
  const date = validateDate(String(req.body.date || ""));
  const text = String(req.body.text || "").trim();
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!text) return res.status(400).json({ error: "Task text is required" });
  const task = createManualTask(date, text);
  res.status(201).json({ task });
});

app.post("/api/summaries", (req, res) => {
  const date = validateDate(String(req.body.date || ""));
  const content = String(req.body.content || "").trim();
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!content) return res.status(400).json({ error: "Summary is required" });

  const info = db.prepare("insert into daily_summaries (date, content) values (?, ?)").run(date, content);
  const summary = db
    .prepare("select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where id = ?")
    .get(info.lastInsertRowid);
  res.status(201).json({ summary });
});

app.get("/api/llm/status", async (_req, res) => {
  const settings = publicLlmSettings();
  res.json({ ok: settings.ok, message: settings.message, model: settings.model, settings });
});

app.post("/api/llm/check", async (_req, res) => {
  res.json(await checkLlm());
});

app.get("/api/llm/settings", (_req, res) => {
  res.json({ settings: publicLlmSettings() });
});

app.post("/api/llm/settings", (req, res) => {
  const current = getLlmSettings();
  const provider = String(req.body.provider || current.provider || "openai");
  if (!["openai", "anthropic"].includes(provider)) return res.status(400).json({ error: "Unsupported provider" });

  const apiUrlProvided = Object.prototype.hasOwnProperty.call(req.body, "apiUrl");
  const apiKeyProvided = Object.prototype.hasOwnProperty.call(req.body, "apiKey");
  const modelProvided = Object.prototype.hasOwnProperty.call(req.body, "model");
  const apiUrlInput = apiUrlProvided ? String(req.body.apiUrl || "").trim() : "";
  const apiKeyInput = apiKeyProvided ? String(req.body.apiKey || "").trim() : "";
  const modelInput = modelProvided ? String(req.body.model || "").trim() : "";
  const providerChanged = provider !== current.provider;
  const apiUrl = apiUrlProvided ? apiUrlInput : current.apiUrl || "";
  const apiKey = apiKeyProvided ? apiKeyInput : current.apiKey || "";
  const model = modelProvided ? modelInput : current.model || (provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini");
  const changed =
    providerChanged ||
    apiUrl !== current.apiUrl ||
    apiKey !== current.apiKey ||
    model !== current.model;
  const checkedOk = changed ? 0 : current.checkedOk ? 1 : 0;
  const message = changed ? "配置已保存，请检查大模型" : current.lastMessage || "配置已保存";

  db.prepare(
    `update llm_settings
     set provider = ?, api_url = ?, api_key = ?, model = ?, checked_ok = ?, last_message = ?, updated_at = datetime('now')
     where id = 1`
  ).run(provider, apiUrl, apiKey, model, checkedOk, message);

  const settings = publicLlmSettings();
  res.json({ settings, ok: settings.ok, message: settings.message, model: settings.model });
});

app.delete("/api/llm/settings", (_req, res) => {
  db.prepare(
    `update llm_settings
     set provider = 'openai', api_url = '', api_key = '', model = 'gpt-4o-mini', checked_ok = 0, last_message = '尚未配置', updated_at = datetime('now')
     where id = 1`
  ).run();
  const settings = publicLlmSettings();
  res.json({ settings, ok: settings.ok, message: settings.message, model: settings.model });
});

app.get(/^\/api\/(week|month)\/([^/]+)$/, (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const corpus = buildCorpus(scope, date);
  res.json({ ...corpus, generated: "" });
});

app.post(/^\/api\/(week|month)\/([^/]+)\/summarize$/, async (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const corpus = buildCorpus(scope, date);
  if (!hasLlmConfig()) return res.status(503).json({ error: "LLM is not configured" });

  const scopeLabel = scope === "month" ? "本月" : "本周";
  const messages = messagesFor(scope, corpus.start);
  const prompt = [
    `你是一个本地知识总结助手。只能基于用户${scopeLabel}的当天总结和该范围内 AI 对话记录作为个人语料，再结合常规知识进行提炼。`,
    `${scopeLabel}范围：${corpus.start} 至 ${corpus.end}`,
    `当天总结：${JSON.stringify(corpus.summaries, null, 2)}`,
    `AI 对话记录：${JSON.stringify(messages, null, 2)}`,
    "如果当天总结和对话记录都为空，请直接说明当前范围还没有可总结的语料，不要编造知识点。",
    "请输出：1. 知识点；2. 可复用方法；3. 下一阶段建议。"
  ].join("\n\n");

  const generated = await callLlm([{ role: "user", content: prompt }]);
  res.json({ ...corpus, generated, llmUsed: true });
});

app.get(/^\/api\/(week|month)\/([^/]+)\/messages$/, (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const { start } = boundsFor(scope, date);
  res.json({ scope, scopeStart: start, messages: messagesFor(scope, start) });
});

app.delete(/^\/api\/(week|month)\/([^/]+)\/messages$/, (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const { start } = boundsFor(scope, date);
  db.prepare("delete from chat_messages where scope_type = ? and scope_start = ?").run(scope, start);
  res.json({ ok: true, scope, scopeStart: start, messages: [] });
});

app.delete("/api/messages/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid message id" });
  const info = db.prepare("delete from chat_messages where id = ?").run(id);
  if (!info.changes) return res.status(404).json({ error: "Message not found" });
  res.json({ ok: true });
});

app.post(/^\/api\/(week|month)\/([^/]+)\/chat$/, async (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  const content = String(req.body.content || "").trim();
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!content) return res.status(400).json({ error: "Message is required" });
  if (!hasLlmConfig()) return res.status(503).json({ error: "LLM is not configured" });

  const corpus = buildCorpus(scope, date);
  const scopeLabel = scope === "month" ? "本月" : "本周";
  db.prepare("insert into chat_messages (week_start, scope_type, scope_start, role, content) values (?, ?, ?, 'user', ?)")
    .run(corpus.start, scope, corpus.start, content);
  const messages = messagesFor(scope, corpus.start);

  const system = [
    "你是用户的本地学习和任务复盘助手。",
    `回答必须优先依据${scopeLabel}当天总结和该范围内 AI 对话记录，允许结合常规知识解释概念，但不要编造用户没有记录过的个人事实。`,
    `${scopeLabel}范围：${corpus.start} 至 ${corpus.end}`,
    `${scopeLabel}当天总结：${JSON.stringify(corpus.summaries, null, 2)}`
  ].join("\n\n");

  const answer = await callLlm([
    { role: "system", content: system },
    ...messages.map((message) => ({ role: message.role, content: message.content }))
  ]);

  db.prepare("insert into chat_messages (week_start, scope_type, scope_start, role, content) values (?, ?, ?, 'assistant', ?)")
    .run(corpus.start, scope, corpus.start, answer);
  res.status(201).json({ answer, messages: messagesFor(scope, corpus.start), llmUsed: true });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Taw Knows API listening on http://127.0.0.1:${port}`);
  console.log(`SQLite data lives at ${dbPath}`);
});
