# Taw Knows

[中文自述文件](./README.md)

Taw Knows is a lightweight local web app for turning Markdown task notes into a daily task board, daily summaries, and weekly review conversations.

## Features

- Reads Markdown files from a local notes directory.
- Parses Markdown checkbox tasks, such as `- [ ] task` and `- [x] done`.
- Lets you review tasks by date.
- Lets you upload `.md` files from the page; the server splits them by date and stores them in SQLite.
- Persists task completion state across restarts.
- Saves daily summaries into a local SQLite database.
- Provides separate weekly and monthly summary pages with isolated corpora.
- Includes weekly and monthly corpus chat views.
- Includes an LLM check button; failed checks disable AI summary and chat actions.

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

## Markdown Import

The recommended flow is uploading `.md` files from the page. Uploaded content is stored in SQLite, so the original file does not need to stay in place.

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

## API Configuration

Copy the configuration template:

```bash
cp .env.example .env
```

Example `.env`:

```env
PORT=4317
DATA_DIR=./data
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
```

If `OPENAI_API_KEY` is not configured before startup, AI summaries and AI chat stay disabled. Configure the key, restart the server, then use the in-page LLM check button.
