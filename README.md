# workspace-core

A configurable personal AI workspace that integrates notes, podcast analysis, AI writing, and self-exploration into one local-first platform.

```
+--------------------------------------------------+
|              workspace-core                       |
|                                                   |
|  +-----------+  +---------+  +--------+           |
|  | Archive   |  | Content |  |Podcast |           |
|  | (notes,   |  | (write, |  |(audio  |           |
|  |  memory)  |  |  draft) |  | feeds) |           |
|  +-----+-----+  +----+----+  +---+----+           |
|        |             |            |                |
|  +-----+-------------+------------+----+           |
|  |          Event Bus (cross-room)     |           |
|  +-----+-------------+------------+----+           |
|        |             |            |                |
|  +-----+-----+  +---+----+  +----+-----+          |
|  | Dialogue  |  |Builders|  |  Notes   |           |
|  | (explore, |  |(agents)|  | Service  |           |
|  |  /drift)  |  |        |  |(markdown)|           |
|  +-----------+  +--------+  +----------+           |
|                                                   |
|  +---------------------------------------------+  |
|  |           AI Provider (pluggable)            |  |
|  |  claude-cli | anthropic-api | openai-api     |  |
|  +---------------------------------------------+  |
+--------------------------------------------------+
```

## Quick Start

```bash
git clone https://github.com/jeorrysyd/workspace-core.git
cd workspace-core
npm install
cp .env.example .env
```

Edit `.env` to configure your AI provider:

```bash
# Option A: Use Claude Code CLI (default, requires Claude subscription)
AI_PROVIDER=claude-cli

# Option B: Use Anthropic API directly
AI_PROVIDER=anthropic-api
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Start the server:

```bash
npm start
# Open http://localhost:3456
```

## AI Providers

| Provider | Setup | Best for |
|----------|-------|----------|
| `claude-cli` | Install [Claude Code](https://claude.ai/code), no API key needed | Claude subscribers, full tool access |
| `anthropic-api` | Set `ANTHROPIC_API_KEY` in `.env` | API users, Docker deployment |
| `openai-api` | Set `OPENAI_API_KEY` in `.env` | Community-maintained, GPT models |

## How to Use

### First time? Try these:

1. **Go to Dialogue** and type `/drift` — the AI will surface thoughts you didn't know you were having
2. **Go to Content**, pick "From Idea", type any topic — the AI researches and drafts for you
3. **Set `NOTES_DIR`** in `.env` to point at your markdown notes folder, then open Archive to browse them

### Typical workflow

```
Your notes/ideas
       |
   [Archive] ──────► [Content] ──► Draft / Script / Article
       |                  ▲
       |                  |
   [Dialogue]      [Builders Digest]
   /drift            AI trends
   /challenge        send to Content
```

---

## Rooms Guide

### Archive (档案馆)

Your personal knowledge base. Import markdown notes, search across them, and build an AI-generated profile of your thinking patterns.

- **Setup**: Set `NOTES_DIR` in `.env` to your notes folder (Obsidian, Logseq, or plain markdown)
- **Features**: Full-text search, date filtering, AI profile generation
- **Cross-room**: Send any note to Content (for writing) or Dialogue (for exploration)
- **Voice upload**: Record or upload audio → Whisper transcription → auto-categorized note

### Content (创作)

AI-powered writing room with two starting paths:

| Path | How it works |
|------|-------------|
| **From Notes** | Scans your recent notes, discovers writing material, generates topic ideas |
| **From Idea** | You input a topic/opinion, AI researches it, generates outline and draft |

Also includes:
- **Topic brainstorming** — divergent thinking across multiple angles
- **Script analysis** — analyze and optimize voiceover/video scripts

### Podcast (播客)

Full podcast analysis pipeline: subscribe to RSS feeds, auto-transcribe with Deepgram, and get AI-generated summaries with timeline markers.

- **Setup**: Set `PODCAST_DIR` in `.env` (requires [podcast-analyze](https://github.com/jeorrysyd/podcast-analyze) project)
- **Features**: Audio player with seeking, AI timeline extraction, note-taking synced to timestamps

### Dialogue (对话)

Self-exploration through AI conversation. Seven slash commands, each designed for a different mode of thinking:

| Command | Name | What it does |
|---------|------|-------------|
| `/drift` | Undercurrent | Surfaces thoughts you didn't know you were having |
| `/dayopen` | Morning | Clears your mind, AI helps plan today's priorities |
| `/trace` | Origin | Traces how an idea evolved over time |
| `/challenge` | Challenge | Stress-tests a belief or assumption |
| `/ghost` | Voice | AI answers questions in your voice/style |
| `/aiview` | AI Views | Records and tracks your evolving views on AI |
| `/roundtable` | Roundtable | Hosts a discussion with AI thought partners |

The AI reads your memory and recent notes for full context in every conversation.

### Builders (AI Builders Digest)

Tracks top AI builders on X/Twitter and YouTube podcasts, generating daily digests of what's happening in the AI builder community.

- Click **"Generate Digest"** to fetch and summarize the latest
- Send digests to Content room for further writing

## Configuration

All personalization is done through `.env` — zero hardcoded values in code:

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_PROVIDER` | AI backend (`claude-cli`, `anthropic-api`, `openai-api`) | Yes |
| `ANTHROPIC_API_KEY` | Anthropic API key | If using `anthropic-api` |
| `OPENAI_API_KEY` | OpenAI API key | If using `openai-api` |
| `PORT` | Server port (default: 3456) | No |
| `APP_NAME` | Display name in UI | No |
| `OWNER_NAME` | Your name (injected into AI prompts) | No |
| `NOTES_DIR` | Path to markdown notes folder | No |
| `PODCAST_DIR` | Path to podcast-analyze project | No |
| `WHISPER_MODEL` | Path to local Whisper model | No |

## Project Structure

```
workspace-core/
├── .env.example          # Configuration template
├── server/
│   ├── index.js          # Express entry point
│   ├── routes/           # API routes (one per room)
│   └── services/
│       ├── ai-provider.js    # Provider factory
│       ├── providers/
│       │   ├── shared.js     # SSE utilities
│       │   ├── claude-cli.js # Claude Code CLI
│       │   └── anthropic.js  # Anthropic SDK
│       ├── notes.js      # Markdown notes service
│       └── memory.js     # Personal memory store
├── modules/              # Frontend room modules
├── js/                   # Core frontend (app.js, api.js)
├── css/                  # Design system
└── data/                 # Runtime data (gitignored)
```

## License

MIT
