# 2026-04-01 Model Gateway

## What Changed

ClaudeCodeFree now supports external model providers through a local Anthropic-compatible gateway layer.

- Added live Kilo and OpenCode model discovery
- Added free-model support in the model catalog
- Added custom provider and custom model settings
- Added gateway routing for Anthropic-compatible and OpenAI-compatible upstream APIs
- Added model picker tabs for `Claude`, `Free`, and `Custom`
- Added a dedicated filter field above the `Free` model list instead of treating filter as a list item
- Simplified `Custom` in `/model` to the practical fields users need most: provider preset, model name, model API id, API key, context size, temperature, and reasoning level
- Fixed the `Free` picker to render at a stable height so filtering does not leave duplicated TUI rows behind
- Fixed `/model` keyboard routing so `Tab` reliably switches `Claude / Free / Custom` even when focus starts inside the `Free` filter or `Custom` text fields, without reusing `←/→` for tab switching
- Fixed `/model` so `←/→` now stay dedicated to effort or custom preset/reasoning changes and no longer collide with tab switching
- Made `/model` option focus less visually misleading by separating cursor focus from selected-model styling in picker lists
- Compressed the `Custom` tab into a denser form layout so provider/model parameters fit without the previous oversized vertical spacing
- Added a smoke-test script for live and mocked provider flows
- Added Anthropic-compatible external streaming support
- Added OpenAI-compatible external streaming support, including streamed tool-call bridging into Anthropic-style events
- Added per-model gateway metadata for context window, max output tokens, default temperature, timeout, and streaming behavior
- Normalized MCP/tool JSON Schema before sending it to external providers so stricter OpenAI-compatible backends receive stable object schemas
- Reworked `WebSearchTool` to use direct outbound search retrieval with normalized result URLs instead of Anthropic's built-in `web_search_20250305` server tool
- Added a SearXNG metasearch backend for `WebSearchTool`, matching the configuration style used in `all_included_deep_research` and falling back to the direct backend when the SearXNG instance is unavailable
- Reworked `WebFetchTool` to use the active model layer for extraction/summarization instead of a hardwired Anthropic Haiku side-call, and removed Anthropic-specific domain preflight checks from the fetch path
- Switched OpenCode backend selection to live `models.dev` metadata instead of model-name heuristics
- Added source-level fallback resolution for `ext:kilo:*` and `ext:opencode:*` models when the cached catalog is stale
- Fixed the leaked-source build so `bun run build` recreates the local runtime stubs, injects the required `MACRO.*` constants, and prepares the bundled `ripgrep` path
- Fixed interactive TUI error handling so pre-stream failures are rendered visibly instead of leaving the session blank
- Fixed transcript toggling so `Ctrl+O` no longer crashes on incomplete sandbox-runtime stubs
- Skipped first-party session-title generation for `ext:*` model sessions so external turns do not depend on Anthropic auth
- Added `install.sh` so a fresh clone can be installed in one command
- Re-enabled built-in `Explore` and `Plan` subagents for local/custom builds and made subagent type lookup case-insensitive so `explore` and `Explore` resolve to the same agent type

## Why

The original Claude Code runtime is tightly coupled to Anthropic's Messages API. A direct provider-layer transplant from other projects would require invasive rewrites of the query engine and tool loop.

The gateway approach preserves the existing runtime while making external providers usable from the same CLI.

## Operational Notes

- Anthropic-compatible and OpenAI-compatible external providers can now stream through the local gateway.
- External tool schemas are normalized before dispatch, which reduces provider-specific JSON Schema breakage for MCP tools and strict function-calling backends.
- `WebSearch` and `WebFetch` now execute on provider-agnostic paths, so external sessions no longer lose those tools just because the active model is not Anthropic-backed.
- Kilo and OpenCode free-model availability can vary because upstream public quotas can rate-limit specific models.
- Some OpenCode free models use Anthropic-compatible transport even when their ids look OpenAI-like. `minimax-m2.5-free` is one example.
- Custom providers are configured through `gatewayProviders` and `gatewayModels`.
- Built-in Claude models still require valid Anthropic auth. If the local Claude subscription token is expired, the CLI now tells the user to re-authenticate instead of appearing to hang.
