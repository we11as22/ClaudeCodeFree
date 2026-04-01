# 2026-04-01 — `dist/` not committed

## What changed

- Added `dist/` to `.gitignore` and removed tracked `dist/cli.js` / `dist/vendor/.../rg` from the repository index.

## Why

- Bundled output is large and regenerable via `./install.sh` or `bun run build`.
- Committed bundles can trigger false positive secret alerts (e.g. third-party constants such as the Visual Studio Code OAuth application id embedded by `@azure/identity`).
