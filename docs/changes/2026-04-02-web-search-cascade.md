# Web search & web fetch: OpenClaude-first, opencode fallback

## WebSearch (`auto` default)

1. **Anthropic server `web_search`** (OpenClaude-style) when the provider supports it.
2. **Exa MCP** (`mcp.exa.ai`) — opencode-style — if step 1 returned no hits or errored.
3. **Local** SearXNG / DuckDuckGo if still no results.

`webSearch.mode: "local"` / `WEB_SEARCH_MODE=local` forces local-only. `WEB_SEARCH_SKIP_EXA=1` / `WEB_SEARCH_SKIP_NATIVE=1` disable steps.

## WebFetch

- **Primary (OpenClaude):** axios, permitted same-host redirects, **Anthropic `domain_info` preflight** unless `skipWebFetchPreflight`, Turndown, binary persist, `applyPromptToMarkdown` / sideQuery.
- **Fallback (opencode):** `fetch` with browser `User-Agent`, Cloudflare 403 challenge retry with `User-Agent: opencode`, `redirect: follow`, 5MB cap, no preflight. Used when primary throws, except `DomainBlockedError` and `EgressBlockedError`.

Implementation: `search.ts`, `exaSearch.ts`, `WebFetchTool/utils.ts` (`getURLMarkdownContent`, `getURLMarkdownContentOpencodeFallback`).
