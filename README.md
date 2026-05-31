# Taw Knows

[English README](./README.en.md)

Taw Knows 是一个轻量化本地网页应用，用来把 Markdown 任务记录转换成每日清单、当天小结和每周复盘对话。

## 功能

- 从本地 Markdown 目录读取笔记。
- 解析 Markdown checkbox 任务，例如 `- [ ] task` 和 `- [x] done`。
- 通过日期选择器查看当天任务。
- 将每日小结保存到本地 SQLite 数据库。
- 提供独立的周总结页面。
- 支持基于本周语料的小结对话。
- 未配置 LLM API key 时，会自动使用本地规则生成总结。

## 启动

```bash
npm install
npm run dev
```

打开：

```txt
http://127.0.0.1:5173/
```

API 服务运行在：

```txt
http://127.0.0.1:4317/
```

## Markdown 目录

默认读取：

```txt
notes/
```

也可以指定自己的笔记目录：

```bash
NOTES_DIR=/path/to/your/notes npm run dev:server
```

日期优先从 frontmatter 中读取：

```md
---
title: Daily note
date: 2026-05-31
---
```

如果没有 frontmatter 日期，应用会尝试从文件名中识别 `YYYY-MM-DD`。

## 本地数据

每日小结和对话记录保存在：

```txt
data/app.db
```

数据库文件不会提交到 Git。

## 可选 LLM

设置 `OPENAI_API_KEY` 后，可以启用 LLM 版本的周总结和对话：

```bash
OPENAI_API_KEY=your_key npm run dev
```

也可以指定模型：

```bash
OPENAI_MODEL=gpt-4o-mini
```

如果没有配置 API key，Taw Knows 仍然可以使用本地规则总结。
