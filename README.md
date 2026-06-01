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

推荐的 Markdown 结构：

```md
### Day 2026-06-01

#### 阅读论文
#### 整理实验记录
#### 写当天总结草稿

### Day 2026-06-02

#### 复盘前一天问题
#### 推进代码实现
```

导入规则：

- 只有以 `### Day` 开头的三级标题会被切分为一天。
- 如果页面中的 LLM 配置已经检查通过，导入时会先让 AI 基于上传的 Markdown 改写为更清晰的人类任务清单，再保存改写后的 Markdown 预览和任务。
- AI 会把碎片化的命令、标题或概念合并成更合理的任务，例如把 `create database`、`create table`、`insert`、`select` 合并为“练习 MySQL 的建库、建表、数据插入和查询流程”。
- 重复上传同一份 Markdown 时，会重新处理并覆盖这份文件对应的预览和任务。
- 没有可用 LLM 时，会使用本地规则：`### Day` 下面的子标题行 `####`、`#####`、`######` 会被识别为任务。
- 普通三级标题不会生成任务。
- 仍然兼容 `- [ ]` 和 `- [x]` checkbox 任务。
- 如果 `### Day` 标题中包含 `YYYY-MM-DD`，使用标题里的日期。
- 如果 `### Day` 标题中没有日期，会从上传当天开始，按三级标题顺序逐天记录。
- 页面支持手动添加清单任务，手动任务和导入任务共享完成状态、进度统计和总结语料。
- 功能菜单置顶，可展开上传、文件管理、日期选择、模型配置和日/夜模式切换。

如果没有三级标题，则退回到 frontmatter 日期：

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

服务端基础配置可以复制模板：

```bash
cp .env.example .env
```

`.env` 示例：

```env
PORT=4317
DATA_DIR=./data
```

大模型 API 在页面中配置，不需要写进 `.env`。页面支持两种协议：

- OpenAI-compatible：填写 API URL、API Key、模型名，例如 `gpt-4o-mini`。
- Anthropic-compatible：填写 API URL、API Key、模型名，例如 `claude-3-5-sonnet-latest`。

API URL 和 API Key 会保存到本地 SQLite，不会提交到 Git，也不会在页面或接口中明文回显；页面只显示脱敏占位。保存配置后，需要点击“检查大模型”，检查通过后才会启用 AI 总结和对话。
