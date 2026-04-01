# Architecture

## Model Gateway

This fork adds a local Anthropic-compatible gateway in [src/services/modelGateway/catalog.ts](/root/asudakov/projects/ClaudeCodeFree/src/services/modelGateway/catalog.ts) and [src/services/modelGateway/server.ts](/root/asudakov/projects/ClaudeCodeFree/src/services/modelGateway/server.ts).

- `catalog.ts` builds a merged model catalog from:
  - built-in Claude models
  - live Kilo gateway models
  - live OpenCode models
  - user-defined `gatewayProviders` + `gatewayModels`
- External models use the `ext:` prefix:
  - `ext:kilo:...`
  - `ext:opencode:...`
  - `ext:custom:...`
- `client.ts` detects these models and points the Anthropic SDK at the local gateway instead of Anthropic directly.
- Gateway metadata now carries per-model context window, max output tokens, default temperature, timeout, headers/body overrides, and streaming capability.

## Protocol Adaptation

The gateway keeps Claude Code's existing Anthropic request path intact and adapts upstream protocols per model.

- `anthropic` backend:
  - forwards requests to an Anthropic-compatible `/messages` endpoint
- `openai-chat` backend:
  - converts Anthropic messages/tools to OpenAI `chat/completions`
  - maps tool calls and tool results both ways
  - maps reasoning into Anthropic-style `thinking` blocks

Streaming is supported for Anthropic-compatible external providers. OpenAI-compatible providers still return `404` on stream creation so Claude Code falls back to its existing non-streaming path without breaking the tool loop.

## UI Integration

The model picker in [src/components/ModelPicker.tsx](/root/asudakov/projects/ClaudeCodeFree/src/components/ModelPicker.tsx) now groups models into:

- `Claude`
- `Free`
- `Custom`

`Free` is the curated tab for public zero-cost gateway models. It now uses a dedicated search box above a fixed-height result list so filtering behaves like a real model dialog instead of mutating the list layout. `Custom` exposes a narrow editor in [GatewayCustomModelEditor.tsx](/root/asudakov/projects/ClaudeCodeFree/src/components/GatewayCustomModelEditor.tsx) with provider preset, model name, model API id, API key, context size, temperature, and reasoning level instead of the earlier JSON-heavy editor.

The custom editor persists `gatewayProviders` and `gatewayModels` through the normal settings pipeline, then refreshes the live gateway catalog so the saved model becomes immediately selectable in the same `/model` session.

## Validation And Testing

The smoke-test script [scripts/test-model-gateway.ts](/root/asudakov/projects/ClaudeCodeFree/scripts/test-model-gateway.ts) covers:

- live catalog refresh
- live free-model calls through Kilo/OpenCode
- custom Anthropic-compatible provider routing
- custom Anthropic-compatible provider streaming with merged headers/body/default temperature
- custom OpenAI-compatible provider routing
- OpenAI-compatible tool-calling round-trip
- built CLI execution with external models

## Runtime Notes

- The interactive TUI and `--bare` path now share a working external-model execution path.
- External model budgeting in [context.ts](/root/asudakov/projects/ClaudeCodeFree/src/utils/context.ts) now respects gateway metadata instead of assuming Anthropic defaults for every `ext:*` model.
- External-model sessions skip the built-in Haiku title-generation request, so `ext:*` turns no longer depend on Anthropic auth just to name a session.
- The local build must inject all required `MACRO.*` values, recreate the leaked-source local runtime stubs, and prepare `dist/vendor/ripgrep/.../rg`; `bun run build` now does all three.
- The sandbox adapter now wraps incomplete stubbed violation stores so transcript toggling (`Ctrl+O`) does not crash when sandboxing is disabled.
- Built-in Claude models still depend on valid Anthropic auth. When that auth is expired, the TUI now shows the real `/login` guidance instead of failing silently.
