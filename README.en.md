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

Recommended Markdown structure:

```md
### Day 2026-06-01

#### Read papers
#### Organize experiment notes
#### Draft the daily summary

### Day 2026-06-02

#### Review yesterday's blockers
#### Continue implementation
```

Import rules:

- Only level-3 headings starting with `### Day` are treated as days.
- Child heading lines under `### Day`, `####`, `#####`, and `######`, become tasks.
- Ordinary level-3 headings do not create tasks.
- Markdown checkbox tasks, `- [ ]` and `- [x]`, are still supported.
- If a `### Day` heading includes `YYYY-MM-DD`, that date is used.
- If a `### Day` heading has no date, dates are assigned from the upload day onward in heading order.
- The page supports manually added checklist tasks. Manual and imported tasks share completion state, progress, and summary corpus.
- A sticky function menu contains upload, document management, date selection, model settings, and light/dark theme controls.

If there are no level-3 headings, the app falls back to frontmatter:

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

Copy the base server configuration template:

```bash
cp .env.example .env
```

Example `.env`:

```env
PORT=4317
DATA_DIR=./data
```

LLM API settings are configured in the page, not in `.env`. Two protocols are supported:

- OpenAI-compatible: API URL, API Key, and model name, such as `gpt-4o-mini`.
- Anthropic-compatible: API URL, API Key, and model name, such as `claude-3-5-sonnet-latest`.

The API URL and API Key are stored in local SQLite. They are not committed to Git and are never returned in plain text by the page or API; only masked placeholders are shown. After saving settings, click the in-page LLM check button. AI summaries and chat are enabled only after the check passes.
