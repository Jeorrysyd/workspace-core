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

## Rooms

- **Archive** — Browse and search your markdown notes, upload voice recordings for transcription
- **Content** — AI-powered topic research, script writing, content optimization
- **Podcast** — Analyze podcast episodes, full audio player with timeline sync
- **Dialogue** — Self-exploration with slash commands (`/drift`, `/trace`, `/challenge`, etc.)
- **Builders** — AI agent workflows and content automation

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
