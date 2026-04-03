# AI Workspace (workspace-core) — Claude Code Guide

## Overview

A configurable personal AI workspace with pluggable AI providers.
All personalization is done via `.env` — zero hardcoded values in code.

## Setup

```bash
cd workspace-core
npm install
cp .env.example .env   # Edit this file with your settings
npm start              # http://localhost:3456
```

## AI Provider System

Configurable via `AI_PROVIDER` in `.env`:

| Provider | How it works |
|----------|-------------|
| `claude-cli` (default) | Spawns `claude -p` subprocess, uses Claude subscription |
| `anthropic-api` | Uses `@anthropic-ai/sdk` directly, requires `ANTHROPIC_API_KEY` |
| `openai-api` | Uses `openai` SDK, requires `OPENAI_API_KEY` (community) |

Architecture:
```
server/services/
  ai-provider.js          # Factory — reads AI_PROVIDER, validates keys, exports provider
  providers/
    shared.js             # SSE utilities (startSSE, sendSSE, endSSE)
    claude-cli.js         # Claude CLI provider (cleanEnv, spawn)
    anthropic.js          # Anthropic SDK provider (native streaming)
```

Key rules:
- `allowedTools` (e.g. WebSearch) only works with `claude-cli`, silently ignored by API providers
- `streamConversation` uses native messages array for API providers (no string flattening)
- `cleanEnv()` only in `claude-cli.js` — strips CLAUDECODE env to prevent recursion
- Missing API key → `process.exit(1)` with clear message (not a stack trace)

## .env Variables

```
AI_PROVIDER=claude-cli        # claude-cli | anthropic-api | openai-api
ANTHROPIC_API_KEY=            # Required if AI_PROVIDER=anthropic-api
OPENAI_API_KEY=               # Required if AI_PROVIDER=openai-api
PORT=3456
APP_NAME=AI Workspace         # Shown in UI header
OWNER_NAME=User               # Injected into AI prompts
NOTES_DIR=~/path/to/notes     # Markdown notes folder (optional)
PODCAST_DIR=~/path/to/podcast # podcast-analyze project (optional)
WHISPER_MODEL=~/path/to/model # Local Whisper model (optional)
```

## Project Structure

```
workspace-core/
├── .env.example              # Configuration template
├── index.html                # Main shell
├── css/base.css              # Design system
├── js/
│   ├── app.js                # Core: module registry + event bus + routing
│   └── api.js                # HTTP client + SSE streaming
├── modules/
│   ├── archive/index.js      # Archive room (notes + memory + profile)
│   ├── content/index.js      # Content/writing room
│   ├── podcast/index.js      # Podcast room
│   ├── dialogue/index.js     # Dialogue room (self-exploration)
│   └── builders/index.js     # AI Builders Digest
├── server/
│   ├── index.js              # Express entry + /api/config
│   ├── routes/               # One route file per room
│   └── services/
│       ├── ai-provider.js    # Provider factory
│       ├── providers/        # claude-cli.js, anthropic.js, shared.js
│       ├── notes.js          # Markdown notes service (reads NOTES_DIR)
│       └── memory.js         # Personal memory store (data/memory/)
└── data/                     # Runtime data (gitignored)
```

## Five Rooms

### Archive
- Displays markdown notes from NOTES_DIR
- Voice upload → Whisper transcription → AI classification
- Cross-room: send entries to Content or Dialogue

### Content (Writing)
- Two paths: "From Notes" (bottom-up) or "From Idea" (top-down)
- AI topic brainstorming, script generation, content optimization
- Context-aware: reads NOTES_DIR notes + memory for AI prompts

### Podcast
- Proxy for PODCAST_DIR analysis results
- Full audio player + timeline sync + note-taking
- Requires PODCAST_DIR to be configured

### Dialogue (Self-exploration)
- Slash commands: /drift /dayopen /trace /challenge /ghost /aiview /roundtable
- Full context: reads memory + recent notes for deep conversation

### Builders
- AI builders digest — tracks top AI builders on X/YouTube
- Generate daily summaries, send to Content room

## External Dependencies

All configured via `.env`:
- **NOTES_DIR**: Markdown folder (read-only import)
- **PODCAST_DIR**: podcast-analyze project (data proxy)
- **WHISPER_MODEL**: Local Whisper model file (audio transcription)
- **AI Provider**: Claude CLI subscription or API key

## Skill Routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.

Key routing rules:
- Product ideas, brainstorming → invoke office-hours
- Bugs, errors, "why is this broken" → invoke investigate
- Ship, deploy, create PR → invoke ship
- QA, test the site → invoke qa
- Code review → invoke review
- Architecture review → invoke plan-eng-review
