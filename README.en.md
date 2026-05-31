# Taw Knows

[中文自述文件](./README.md)

Taw Knows is a lightweight local web app for turning Markdown task notes into a daily task board, daily summaries, and weekly review conversations.

## Features

- Reads Markdown files from a local notes directory.
- Parses Markdown checkbox tasks, such as `- [ ] task` and `- [x] done`.
- Lets you review tasks by date.
- Saves daily summaries into a local SQLite database.
- Provides a weekly summary page.
- Includes a weekly corpus chat view.
- Falls back to local rule-based summaries when no LLM API key is configured.

## Getting Started

```bash
npm install
npm run dev
```

Open:

```txt
http://127.0.0.1:5173/
```

The API server runs on:

```txt
http://127.0.0.1:4317/
```

## Notes Directory

By default, the app reads Markdown files from:

```txt
notes/
```

You can point it at another folder:

```bash
NOTES_DIR=/path/to/your/notes npm run dev:server
```

Dates are detected from frontmatter first:

```md
---
title: Daily note
date: 2026-05-31
---
```

If no frontmatter date exists, the app tries to read a `YYYY-MM-DD` date from the filename.

## Local Data

Daily summaries and chat messages are stored in:

```txt
data/app.db
```

The database file is ignored by Git.

## Optional LLM

Set `OPENAI_API_KEY` to enable LLM-backed weekly summaries and chat responses:

```bash
OPENAI_API_KEY=your_key npm run dev
```

You can also set:

```bash
OPENAI_MODEL=gpt-4o-mini
```

Without an API key, Taw Knows still works with local rule-based summaries.
