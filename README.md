# Taw Knows

[English README](./README.en.md)

Taw Knows 是一个轻量化本地网页应用，用来把 Markdown 任务记录转换成每日清单、当天小结和每周复盘对话。

## 功能

- 从本地 Markdown 目录读取笔记。
- 解析 Markdown checkbox 任务，例如 `- [ ] task` 和 `- [x] done`。
- 通过日期选择器查看当天任务。
- 在页面上传 `.md` 文件，后端会按日期切分并写入 SQLite。
- 点击任务即可更新完成状态，重启后仍会保留。
- 将每日小结保存到本地 SQLite 数据库。
- 提供独立的周总结和月总结页面，二者使用各自范围内的语料。
- 支持基于本周或本月语料的小结对话。
- 页面提供“大模型检查”按钮；检查失败时会禁用 AI 总结和对话。

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

## Markdown 导入

现在推荐直接在页面上传 `.md` 文件。上传后，内容会被保存到 SQLite，不依赖原文件是否还在本地。

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

## API 配置

复制配置模板：

```bash
cp .env.example .env
```

`.env` 示例：

```env
PORT=4317
DATA_DIR=./data
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4o-mini
```

如果启动前没有配置 `OPENAI_API_KEY`，页面里的 AI 总结和 AI 对话会保持禁用。配置完成后重新启动服务，再点击“检查大模型”确认可用。
