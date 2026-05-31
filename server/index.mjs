import Database from "better-sqlite3";
import express from "express";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  addDays,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfWeek
} from "date-fns";

const app = express();
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const rootDir = process.cwd();
const notesDir = path.resolve(process.env.NOTES_DIR || path.join(rootDir, "notes"));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const dbPath = path.join(dataDir, "app.db");
const port = Number(process.env.PORT || 4317);

fs.mkdirSync(notesDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
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

app.use(express.json({ limit: "1mb" }));

function walkMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdownFiles(fullPath);
    if (entry.isFile() && /\.md$/i.test(entry.name)) return [fullPath];
    return [];
  });
}

function dateFromFile(filePath, frontmatter) {
  if (frontmatter.date) {
    const parsed = parseISO(String(frontmatter.date));
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }

  const match = path.basename(filePath).match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const stat = fs.statSync(filePath);
  return format(stat.mtime, "yyyy-MM-dd");
}

function parseTasks(content, filePath, date) {
  return content
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/);
      if (!match) return null;
      return {
        id: `${filePath}:${index + 1}`,
        date,
        file: path.relative(rootDir, filePath),
        line: index + 1,
        text: match[2],
        completed: match[1].toLowerCase() === "x"
      };
    })
    .filter(Boolean);
}

function parseNotes() {
  return walkMarkdownFiles(notesDir).flatMap((filePath) => {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = matter(raw);
    const date = dateFromFile(filePath, parsed.data);
    return [
      {
        date,
        file: path.relative(rootDir, filePath),
        title: parsed.data.title || path.basename(filePath, ".md"),
        html: markdown.render(parsed.content),
        tasks: parseTasks(parsed.content, filePath, date)
      }
    ];
  });
}

function validateDate(input) {
  const parsed = parseISO(input);
  if (!isValid(parsed)) return null;
  return format(parsed, "yyyy-MM-dd");
}

function getSummariesBetween(start, end) {
  return db
    .prepare(
      "select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where date between ? and ? order by date asc, id asc"
    )
    .all(start, end);
}

function weekBounds(date) {
  const parsed = parseISO(date);
  const start = startOfWeek(parsed, { weekStartsOn: 1 });
  const end = endOfWeek(parsed, { weekStartsOn: 1 });
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd")
  };
}

function buildWeeklyCorpus(start, end) {
  const notes = parseNotes();
  const tasks = notes.flatMap((note) => note.tasks).filter((task) => task.date >= start && task.date <= end);
  const summaries = getSummariesBetween(start, end);
  return { tasks, summaries };
}

function localWeeklySummary({ tasks, summaries }, start, end) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.completed).length;
  const open = total - done;
  const summaryText = summaries.map((item) => `${item.date}: ${item.content}`).join("\n");
  const openTasks = tasks.filter((task) => !task.completed).slice(0, 8).map((task) => `- ${task.text}`).join("\n");

  return [
    `本周范围：${start} 至 ${end}`,
    `任务概览：共 ${total} 项，已完成 ${done} 项，未完成 ${open} 项。`,
    summaryText ? `小结线索：\n${summaryText}` : "小结线索：这一周还没有保存小结。",
    openTasks ? `可继续推进：\n${openTasks}` : "可继续推进：没有从 Markdown 中发现未完成任务。",
    "知识点建议：可以把本周反复出现的任务主题提炼成 3-5 个概念，再为每个概念补一个可复用的判断标准或操作步骤。"
  ].join("\n\n");
}

async function callLlm(messages) {
  if (!process.env.OPENAI_API_KEY) return null;
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
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || null;
}

app.get("/api/config", (_req, res) => {
  res.json({
    notesDir,
    dataPath: dbPath,
    llmEnabled: Boolean(process.env.OPENAI_API_KEY)
  });
});

app.get("/api/dates", (_req, res) => {
  const notes = parseNotes();
  const dates = [...new Set(notes.map((note) => note.date))].sort();
  res.json({ dates });
});

app.get("/api/day/:date", (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });

  const notes = parseNotes().filter((note) => note.date === date);
  const summaries = db
    .prepare(
      "select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where date = ? order by id desc"
    )
    .all(date);

  res.json({
    date,
    notes,
    tasks: notes.flatMap((note) => note.tasks),
    summaries
  });
});

app.post("/api/summaries", (req, res) => {
  const date = validateDate(String(req.body.date || ""));
  const content = String(req.body.content || "").trim();
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!content) return res.status(400).json({ error: "Summary is required" });

  const info = db
    .prepare("insert into daily_summaries (date, content) values (?, ?)")
    .run(date, content);
  const summary = db
    .prepare(
      "select id, date, content, created_at as createdAt, updated_at as updatedAt from daily_summaries where id = ?"
    )
    .get(info.lastInsertRowid);

  res.status(201).json({ summary });
});

app.get("/api/week/:date", async (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const { start, end } = weekBounds(date);
  const corpus = buildWeeklyCorpus(start, end);
  res.json({
    start,
    end,
    ...corpus,
    generated: localWeeklySummary(corpus, start, end)
  });
});

app.post("/api/week/:date/summarize", async (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const { start, end } = weekBounds(date);
  const corpus = buildWeeklyCorpus(start, end);
  const local = localWeeklySummary(corpus, start, end);

  const prompt = [
    "你是一个本地知识总结助手。只能基于用户本周 Markdown 任务与每日小结作为个人语料，再结合常规知识进行提炼。",
    `周范围：${start} 至 ${end}`,
    `任务：${JSON.stringify(corpus.tasks, null, 2)}`,
    `小结：${JSON.stringify(corpus.summaries, null, 2)}`,
    "请输出：1. 本周知识点；2. 可复用方法；3. 下周建议。"
  ].join("\n\n");

  const generated = (await callLlm([{ role: "user", content: prompt }]).catch(() => null)) || local;
  res.json({ start, end, generated, llmUsed: Boolean(process.env.OPENAI_API_KEY) });
});

app.get("/api/week/:date/messages", (req, res) => {
  const date = validateDate(req.params.date);
  if (!date) return res.status(400).json({ error: "Invalid date" });
  const { start } = weekBounds(date);
  const messages = db
    .prepare("select id, week_start as weekStart, role, content, created_at as createdAt from chat_messages where week_start = ? order by id asc")
    .all(start);
  res.json({ weekStart: start, messages });
});

app.post("/api/week/:date/chat", async (req, res) => {
  const date = validateDate(req.params.date);
  const content = String(req.body.content || "").trim();
  if (!date) return res.status(400).json({ error: "Invalid date" });
  if (!content) return res.status(400).json({ error: "Message is required" });

  const { start, end } = weekBounds(date);
  const corpus = buildWeeklyCorpus(start, end);
  db.prepare("insert into chat_messages (week_start, role, content) values (?, 'user', ?)").run(start, content);

  const system = [
    "你是用户的本地学习和任务复盘助手。",
    "回答必须优先依据本周任务和小结语料，允许结合常规知识解释概念，但不要编造用户没有记录过的个人事实。",
    `本周范围：${start} 至 ${end}`,
    `本周任务：${JSON.stringify(corpus.tasks, null, 2)}`,
    `本周小结：${JSON.stringify(corpus.summaries, null, 2)}`
  ].join("\n\n");

  const fallback = `我会基于这周的记录回答。你问的是：“${content}”。\n\n当前本周共有 ${corpus.tasks.length} 个 Markdown 任务和 ${corpus.summaries.length} 条每日小结。建议先围绕已记录的小结提炼关键词，再把未完成任务整理成下周的行动项。`;
  const answer =
    (await callLlm([
      { role: "system", content: system },
      { role: "user", content }
    ]).catch(() => null)) || fallback;

  db.prepare("insert into chat_messages (week_start, role, content) values (?, 'assistant', ?)").run(start, answer);
  const messages = db
    .prepare("select id, week_start as weekStart, role, content, created_at as createdAt from chat_messages where week_start = ? order by id asc")
    .all(start);
  res.status(201).json({ answer, messages, llmUsed: Boolean(process.env.OPENAI_API_KEY) });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Taw Knows API listening on http://127.0.0.1:${port}`);
  console.log(`Reading Markdown from ${notesDir}`);
});
