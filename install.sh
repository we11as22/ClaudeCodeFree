#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.bun/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

if ! command -v rg >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ripgrep
  else
    echo "ripgrep (rg) is required but was not found" >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"
bun install
bun run build

mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/claude" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="\$HOME/.bun/bin:\$PATH"
if [ "\${TERM:-}" = "dumb" ] || [ -z "\${TERM:-}" ]; then
  export TERM="xterm-256color"
fi
exec bun "$ROOT_DIR/dist/cli.js" "\$@"
EOF
chmod +x "$HOME/.local/bin/claude"

echo "Installed Claude Code Free to $HOME/.local/bin/claude"
