# Claude Code — Leaked Source (2026-03-31)

> **On March 31, 2026, the full source code of Anthropic's Claude Code CLI was leaked** via a `.map` file exposed in their npm registry.

---

## How It Leaked

[Chaofan Shou (@Fried_rice)](https://x.com/Fried_rice) discovered the leak and posted it publicly:

> **"Claude code source code has been leaked via a map file in their npm registry!"**
>
> — [@Fried_rice, March 31, 2026](https://x.com/Fried_rice/status/2038894956459290963)

The source map file in the published npm package contained a reference to the full, unobfuscated TypeScript source, which was downloadable as a zip archive from Anthropic's R2 storage bucket.

---

## Overview

Claude Code is Anthropic's official CLI tool that lets you interact with Claude directly from the terminal to perform software engineering tasks — editing files, running commands, searching codebases, managing git workflows, and more.

This repository contains the leaked `src/` directory.

- **Leaked on**: 2026-03-31
- **Language**: TypeScript
- **Runtime**: Bun
- **Terminal UI**: React + [Ink](https://github.com/vadimdemedes/ink) (React for CLI)
- **Scale**: ~1,900 files, 512,000+ lines of code

---

## Added In This Fork

This fork now includes a local multi-provider model gateway for using non-Anthropic models from the existing Claude Code UI and tool loop.

- Free models from Kilo and OpenCode are merged into the model catalog.
- The model picker now separates models into `Claude`, `Free`, and `Custom` tabs.
- `Free` now has a dedicated filter box above the model list, and `Custom` uses a short provider form instead of the earlier JSON-heavy editor.
- User-defined providers and models can be added through settings or directly from `/model`, with Anthropic-compatible or OpenAI-compatible upstream APIs.
- External models run through a local Anthropic-compatible adapter, so the existing QueryEngine and tool loop keep working.
- `WebSearch` and `WebFetch` now also work through provider-agnostic paths instead of relying on Anthropic-only search/fetch behavior.
- `WebSearch` uses a cascade when `webSearch.mode` is `auto` (default): **Anthropic server `web_search` first** (OpenClaude-style when supported), then **Exa MCP** (opencode-style) if native yields nothing, then **local SearXNG/DuckDuckGo** if needed. Set `webSearch.mode` to `"local"` or `WEB_SEARCH_MODE=local` for local-only.
- A reproducible smoke-test is included: `bun run test:model-gateway`
- The `dist/` build output is not committed (avoids huge diffs and false GitHub secret alerts on bundled third-party constants such as the VS Code OAuth client id).

### Quick Start

```bash
./install.sh
claude --bare -p --model ext:kilo:kilo-auto/free "Reply with exactly: ok"
```

`./install.sh` is the one-command bootstrap after `git clone`: it installs Bun if needed, ensures `ripgrep` is present, prepares the missing local runtime stubs, builds the CLI, and installs the local `claude` wrapper to `~/.local/bin/claude`.

`bun run build` now also follows the leaked-source build requirements by itself: it prepares the missing local runtime stubs, injects the required `MACRO.*` constants, and prepares the bundled `ripgrep` path under `dist/vendor/...`, so the interactive TUI no longer fails on `MACRO is not defined`, missing `rg`, or missing local runtime shims.

Built-in Claude models still require a valid Anthropic login or API key. If your local Claude subscription token has expired, the TUI now surfaces the real error instead of silently doing nothing; re-authenticate with `claude auth login`.

`Ctrl+O` transcript view is also fixed in this fork. The leaked build-guide sandbox stub did not implement the full violation-store API used by the TUI, so transcript toggling could crash with `store.subscribe is not a function`. The compatibility layer and bootstrap stubs now provide the required methods.

### Web Search Provider

`WebSearchTool` can use SearXNG the same way as `all_included_deep_research`. In **`auto`** mode, local search runs **after** Anthropic native search and Exa when those paths do not return hits.

**WebFetch** follows **OpenClaude** by default: axios, same-host redirect policy, optional **Anthropic `domain_info` preflight** (unless `skipWebFetchPreflight`), Turndown, binary persistence, then **sideQuery** to apply your prompt. If that path fails (except explicit **domain block** or **egress allowlist** errors), an **opencode-style** `fetch` runs as fallback (Chrome `User-Agent`, Cloudflare challenge retry with `User-Agent: opencode`, `redirect: follow`, 5MB cap).

Optional cascade controls:

```bash
WEB_SEARCH_MODE=local          # only SearXNG / DuckDuckGo (no Anthropic server tool, no Exa)
WEB_SEARCH_SKIP_NATIVE=1       # skip Anthropic server web_search
WEB_SEARCH_SKIP_EXA=1          # skip Exa MCP
```

`settings.json` → `"webSearch": { "mode": "auto" | "local", ... }`.

Environment variables:

```bash
SEARCH_PROVIDER=searxng
SEARXNG_INSTANCE_URL=http://localhost:8080
SEARXNG_API_KEY=
SEARXNG_MAX_RESULTS=8
SEARXNG_LANGUAGE=en
SEARXNG_CATEGORIES=
SEARXNG_ENGINES=
SEARXNG_SAFESEARCH=0
SEARXNG_TIMEOUT_MS=30000
```

Equivalent settings:

```json
{
  "webSearch": {
    "provider": "searxng",
    "searxng": {
      "instanceURL": "http://localhost:8080",
      "maxResults": 8,
      "language": "en",
      "categories": "",
      "engines": "",
      "safesearch": 0,
      "timeoutMs": 30000
    }
  }
}
```

If `SEARCH_PROVIDER=searxng` is set but the instance is unavailable, Claude Code falls back to the built-in direct search backend instead of failing the tool call.

### Custom Provider Settings

`/model` → `Custom` now opens a compact editor that saves:

- provider preset
- model name
- model API id
- API key
- context window
- temperature
- reasoning level

Add providers in `~/.claude/settings.json` or pass them with `--settings`:

```json
{
  "gatewayProviders": {
    "my-openai": {
      "type": "openai-chat",
      "name": "My OpenAI-Compatible Provider",
      "baseURL": "https://example.com/v1",
      "apiKeyEnv": "MY_PROVIDER_API_KEY",
      "timeoutMs": 120000
    }
  },
  "gatewayModels": [
    {
      "id": "my-model",
      "name": "My Model",
      "provider": "my-openai",
      "model": "provider/model-id",
      "contextWindow": 262144,
      "maxOutputTokens": 16384,
      "temperature": 0.2,
      "free": false
    }
  ]
}
```

Then use:

```bash
claude --model ext:custom:my-model
```

---

## Directory Structure

```
src/
├── main.tsx                 # Entrypoint (Commander.js-based CLI parser)
├── commands.ts              # Command registry
├── tools.ts                 # Tool registry
├── Tool.ts                  # Tool type definitions
├── QueryEngine.ts           # LLM query engine (core Anthropic API caller)
├── context.ts               # System/user context collection
├── cost-tracker.ts          # Token cost tracking
│
├── commands/                # Slash command implementations (~50)
├── tools/                   # Agent tool implementations (~40)
├── components/              # Ink UI components (~140)
├── hooks/                   # React hooks
├── services/                # External service integrations
├── screens/                 # Full-screen UIs (Doctor, REPL, Resume)
├── types/                   # TypeScript type definitions
├── utils/                   # Utility functions
│
├── bridge/                  # IDE integration bridge (VS Code, JetBrains)
├── coordinator/             # Multi-agent coordinator
├── plugins/                 # Plugin system
├── skills/                  # Skill system
├── keybindings/             # Keybinding configuration
├── vim/                     # Vim mode
├── voice/                   # Voice input
├── remote/                  # Remote sessions
├── server/                  # Server mode
├── memdir/                  # Memory directory (persistent memory)
├── tasks/                   # Task management
├── state/                   # State management
├── migrations/              # Config migrations
├── schemas/                 # Config schemas (Zod)
├── entrypoints/             # Initialization logic
├── ink/                     # Ink renderer wrapper
├── buddy/                   # Companion sprite (Easter egg)
├── native-ts/               # Native TypeScript utils
├── outputStyles/            # Output styling
├── query/                   # Query pipeline
└── upstreamproxy/           # Proxy configuration
```

---

## Core Architecture

### 1. Tool System (`src/tools/`)

Every tool Claude Code can invoke is implemented as a self-contained module. Each tool defines its input schema, permission model, and execution logic.

| Tool | Description |
|---|---|
| `BashTool` | Shell command execution |
| `FileReadTool` | File reading (images, PDFs, notebooks) |
| `FileWriteTool` | File creation / overwrite |
| `FileEditTool` | Partial file modification (string replacement) |
| `GlobTool` | File pattern matching search |
| `GrepTool` | ripgrep-based content search |
| `WebFetchTool` | Fetch URL content |
| `WebSearchTool` | Web search |
| `AgentTool` | Sub-agent spawning |
| `SkillTool` | Skill execution |
| `MCPTool` | MCP server tool invocation |
| `LSPTool` | Language Server Protocol integration |
| `NotebookEditTool` | Jupyter notebook editing |
| `TaskCreateTool` / `TaskUpdateTool` | Task creation and management |
| `SendMessageTool` | Inter-agent messaging |
| `TeamCreateTool` / `TeamDeleteTool` | Team agent management |
| `EnterPlanModeTool` / `ExitPlanModeTool` | Plan mode toggle |
| `EnterWorktreeTool` / `ExitWorktreeTool` | Git worktree isolation |
| `ToolSearchTool` | Deferred tool discovery |
| `CronCreateTool` | Scheduled trigger creation |
| `RemoteTriggerTool` | Remote trigger |
| `SleepTool` | Proactive mode wait |
| `SyntheticOutputTool` | Structured output generation |

### 2. Command System (`src/commands/`)

User-facing slash commands invoked with `/` prefix.

| Command | Description |
|---|---|
| `/commit` | Create a git commit |
| `/review` | Code review |
| `/compact` | Context compression |
| `/mcp` | MCP server management |
| `/config` | Settings management |
| `/doctor` | Environment diagnostics |
| `/login` / `/logout` | Authentication |
| `/memory` | Persistent memory management |
| `/skills` | Skill management |
| `/tasks` | Task management |
| `/vim` | Vim mode toggle |
| `/diff` | View changes |
| `/cost` | Check usage cost |
| `/theme` | Change theme |
| `/context` | Context visualization |
| `/pr_comments` | View PR comments |
| `/resume` | Restore previous session |
| `/share` | Share session |
| `/desktop` | Desktop app handoff |
| `/mobile` | Mobile app handoff |

### 3. Service Layer (`src/services/`)

| Service | Description |
|---|---|
| `api/` | Anthropic API client, file API, bootstrap |
| `mcp/` | Model Context Protocol server connection and management |
| `oauth/` | OAuth 2.0 authentication flow |
| `lsp/` | Language Server Protocol manager |
| `analytics/` | GrowthBook-based feature flags and analytics |
| `plugins/` | Plugin loader |
| `compact/` | Conversation context compression |
| `policyLimits/` | Organization policy limits |
| `remoteManagedSettings/` | Remote managed settings |
| `extractMemories/` | Automatic memory extraction |
| `tokenEstimation.ts` | Token count estimation |
| `teamMemorySync/` | Team memory synchronization |

### 4. Bridge System (`src/bridge/`)

A bidirectional communication layer connecting IDE extensions (VS Code, JetBrains) with the Claude Code CLI.

- `bridgeMain.ts` — Bridge main loop
- `bridgeMessaging.ts` — Message protocol
- `bridgePermissionCallbacks.ts` — Permission callbacks
- `replBridge.ts` — REPL session bridge
- `jwtUtils.ts` — JWT-based authentication
- `sessionRunner.ts` — Session execution management

### 5. Permission System (`src/hooks/toolPermission/`)

Checks permissions on every tool invocation. Either prompts the user for approval/denial or automatically resolves based on the configured permission mode (`default`, `plan`, `bypassPermissions`, `auto`, etc.).

### 6. Feature Flags

Dead code elimination via Bun's `bun:bundle` feature flags:

```typescript
import { feature } from 'bun:bundle'

// Inactive code is completely stripped at build time
const voiceCommand = feature('VOICE_MODE')
  ? require('./commands/voice/index.js').default
  : null
```

Notable flags: `PROACTIVE`, `KAIROS`, `BRIDGE_MODE`, `DAEMON`, `VOICE_MODE`, `AGENT_TRIGGERS`, `MONITOR_TOOL`

---

## Key Files in Detail

### `QueryEngine.ts` (~46K lines)

The core engine for LLM API calls. Handles streaming responses, tool-call loops, thinking mode, retry logic, and token counting.

### `Tool.ts` (~29K lines)

Defines base types and interfaces for all tools — input schemas, permission models, and progress state types.

### `commands.ts` (~25K lines)

Manages registration and execution of all slash commands. Uses conditional imports to load different command sets per environment.

### `main.tsx`

Commander.js-based CLI parser + React/Ink renderer initialization. At startup, parallelizes MDM settings, keychain prefetch, and GrowthBook initialization for faster boot.

---

## Tech Stack

| Category | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Language | TypeScript (strict) |
| Terminal UI | [React](https://react.dev) + [Ink](https://github.com/vadimdemedes/ink) |
| CLI Parsing | [Commander.js](https://github.com/tj/commander.js) (extra-typings) |
| Schema Validation | [Zod v4](https://zod.dev) |
| Code Search | [ripgrep](https://github.com/BurntSushi/ripgrep) (via GrepTool) |
| Protocols | [MCP SDK](https://modelcontextprotocol.io), LSP |
| API | [Anthropic SDK](https://docs.anthropic.com) |
| Telemetry | OpenTelemetry + gRPC |
| Feature Flags | GrowthBook |
| Auth | OAuth 2.0, JWT, macOS Keychain |

---

## Notable Design Patterns

### Parallel Prefetch

Startup time is optimized by prefetching MDM settings, keychain reads, and API preconnect in parallel — before heavy module evaluation begins.

```typescript
// main.tsx — fired as side-effects before other imports
startMdmRawRead()
startKeychainPrefetch()
```

### Lazy Loading

Heavy modules (OpenTelemetry ~400KB, gRPC ~700KB) are deferred via dynamic `import()` until actually needed.

### Agent Swarms

Sub-agents are spawned via `AgentTool`, with `coordinator/` handling multi-agent orchestration. `TeamCreateTool` enables team-level parallel work.

### Skill System

Reusable workflows defined in `skills/` and executed through `SkillTool`. Users can add custom skills.

### Plugin Architecture

Built-in and third-party plugins are loaded through the `plugins/` subsystem.

---

## Disclaimer

This repository archives source code that was leaked from Anthropic's npm registry on **2026-03-31**. All original source code is the property of [Anthropic](https://www.anthropic.com).
