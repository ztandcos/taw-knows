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
`);

const chatColumns = db.prepare("pragma table_info(chat_messages)").all().map((column) => column.name);
if (!chatColumns.includes("scope_type")) {
  db.exec("alter table chat_messages add column scope_type text not null default 'week'");
}
if (!chatColumns.includes("scope_start")) {
  db.exec("alter table chat_messages add column scope_start text");
  db.exec("update chat_messages set scope_start = week_start where scope_start is null");
}

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
    const match = line.match(/^\s{0,3}###\s+(.+?)\s*$/);
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
        content: lines.slice(item.index, next).join("\n").trim()
      };
    });
  }

  const fallbackDate = frontmatterDate || format(new Date(), "yyyy-MM-dd");
  return [
    {
      date: fallbackDate,
      title: parsed.data.title || path.basename(filename, ".md"),
      content: parsed.content.trim()
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

function importMarkdown(filename, content) {
  const hash = hashText(content);
  const existing = db.prepare("select id from imported_documents where content_hash = ?").get(hash);
  if (existing) return { documentId: existing.id, duplicate: true, days: [] };

  const insertDocument = db.prepare("insert into imported_documents (filename, content, content_hash) values (?, ?, ?)");
  const insertDay = db.prepare("insert into day_notes (document_id, date, title, content) values (?, ?, ?, ?)");
  const insertTask = db.prepare(`
    insert into tasks (id, document_id, day_note_id, date, line, text, completed)
    values (@id, @documentId, @dayNoteId, @date, @line, @text, @completed)
  `);

  return db.transaction(() => {
    const documentId = Number(insertDocument.run(filename, content, hash).lastInsertRowid);
    const days = splitMarkdownByDate(filename, content).map((day) => {
      const dayNoteId = Number(insertDay.run(documentId, day.date, day.title, day.content).lastInsertRowid);
      const tasks = parseTasks(day.content, documentId, dayNoteId, day.date);
      tasks.forEach((task) => insertTask.run(task));
      return { ...day, id: dayNoteId, taskCount: tasks.length };
    });
    return { documentId, duplicate: false, days };
  })();
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

function localSummary(corpus) {
  const label = corpus.scope === "month" ? "本月" : "本周";
  const total = corpus.tasks.length;
  const done = corpus.tasks.filter((task) => task.completed).length;
  const openTasks = corpus.tasks.filter((task) => !task.completed).slice(0, 10).map((task) => `- ${task.text}`).join("\n");
  const summaryText = corpus.summaries.map((item) => `${item.date}: ${item.content}`).join("\n");

  return [
    `${label}范围：${corpus.start} 至 ${corpus.end}`,
    `任务概览：共 ${total} 项，已完成 ${done} 项，未完成 ${total - done} 项。`,
    summaryText ? `每日小结语料：\n${summaryText}` : "每日小结语料：当前范围还没有保存小结。",
    openTasks ? `待继续推进：\n${openTasks}` : "待继续推进：当前范围没有未完成任务。",
    `${label}复盘建议：围绕重复出现的任务主题提炼知识点，再把它们改写成下次可以直接执行的步骤。`
  ].join("\n\n");
}

function hasLlmConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function callLlm(messages) {
  if (!hasLlmConfig()) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI API returned an empty response");
  return content;
}

async function checkLlm() {
  if (!hasLlmConfig()) return { ok: false, message: "启动前未配置 OPENAI_API_KEY", model: process.env.OPENAI_MODEL || "gpt-4o-mini" };
  try {
    await callLlm([{ role: "user", content: "请只回复：ok" }]);
    return { ok: true, message: "OpenAI API 检查通过", model: process.env.OPENAI_MODEL || "gpt-4o-mini" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "OpenAI API 检查失败", model: process.env.OPENAI_MODEL || "gpt-4o-mini" };
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
  res.json({
    dataPath: dbPath,
    llmConfigured: hasLlmConfig(),
    llmModel: process.env.OPENAI_MODEL || "gpt-4o-mini"
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
  res.json({ total, completed, percent: total ? Math.round((completed / total) * 100) : 0 });
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
      group by imported_documents.id
      order by imported_documents.imported_at desc, imported_documents.id desc`
    )
    .all();
  res.json({ documents });
});

app.post("/api/import", (req, res) => {
  const filename = String(req.body.filename || "uploaded.md").trim();
  const content = String(req.body.content || "");
  if (!filename.toLowerCase().endsWith(".md")) return res.status(400).json({ error: "Only .md files are supported" });
  if (!content.trim()) return res.status(400).json({ error: "Markdown content is required" });
  const result = importMarkdown(filename, content);
  res.status(result.duplicate ? 200 : 201).json(result);
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
    db.prepare("delete from tasks where document_id = ?").run(id);
    db.prepare("delete from day_notes where document_id = ?").run(id);
    db.prepare("delete from imported_documents where id = ?").run(id);
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
  res.json(await checkLlm());
});

app.post("/api/llm/check", async (_req, res) => {
  res.json(await checkLlm());
});

app.get(/^\/api\/(week|month)\/([^/]+)$/, (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const corpus = buildCorpus(scope, date);
  res.json({ ...corpus, generated: localSummary(corpus) });
});

app.post(/^\/api\/(week|month)\/([^/]+)\/summarize$/, async (req, res) => {
  const scope = req.params[0];
  const date = validateDate(req.params[1]);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const corpus = buildCorpus(scope, date);
  if (!hasLlmConfig()) return res.status(503).json({ error: "LLM is not configured" });

  const scopeLabel = scope === "month" ? "本月" : "本周";
  const prompt = [
    `你是一个本地知识总结助手。只能基于用户${scopeLabel} Markdown 任务与每日小结作为个人语料，再结合常规知识进行提炼。`,
    `${scopeLabel}范围：${corpus.start} 至 ${corpus.end}`,
    `任务：${JSON.stringify(corpus.tasks, null, 2)}`,
    `每日小结：${JSON.stringify(corpus.summaries, null, 2)}`,
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

  const system = [
    "你是用户的本地学习和任务复盘助手。",
    `回答必须优先依据${scopeLabel}任务和每日小结语料，允许结合常规知识解释概念，但不要编造用户没有记录过的个人事实。`,
    `${scopeLabel}范围：${corpus.start} 至 ${corpus.end}`,
    `${scopeLabel}任务：${JSON.stringify(corpus.tasks, null, 2)}`,
    `${scopeLabel}小结：${JSON.stringify(corpus.summaries, null, 2)}`
  ].join("\n\n");

  const answer = await callLlm([
    { role: "system", content: system },
    { role: "user", content }
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
