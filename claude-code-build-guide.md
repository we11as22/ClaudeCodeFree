# Сборка Claude Code из исходников

Пошаговый гайд по сборке Claude Code CLI из репозитория [alesha-pro/claude-code](https://github.com/alesha-pro/claude-code.git) — утёкших исходников Anthropic Claude Code.

## Требования

- Linux (Ubuntu 22.04+) или macOS
- 4GB RAM, 4 ядра CPU, 30GB диска
- Bun >= 1.3
- Git

## 1. Установка Bun

```bash
curl -fsSL https://bun.sh/install | bash
export PATH=$HOME/.bun/bin:$PATH
```

## 2. Клонирование репозитория

```bash
cd ~
git clone https://github.com/alesha-pro/claude-code.git
cd claude-code
```

Репозиторий содержит только `src/` (~1900 файлов, ~512K строк TypeScript) и `README.md`. Нет ни `package.json`, ни `tsconfig.json` — их нужно создать вручную.

## 3. Создание package.json

```bash
cat > package.json << 'EOF'
{
  "name": "claude-code",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "bun build src/entrypoints/cli.tsx --target=bun --outdir=dist --define 'MACRO.VERSION=\"1.0.34\"' --define 'MACRO.BUILD_TIMESTAMP=\"2026-03-31\"'",
    "start": "bun run dist/cli.js"
  },
  "dependencies": {
    "@alcalzone/ansi-tokenize": "*",
    "@anthropic-ai/sdk": "*",
    "@anthropic-ai/bedrock-sdk": "*",
    "@anthropic-ai/vertex-sdk": "*",
    "@aws-sdk/client-bedrock-runtime": "*",
    "@aws-sdk/client-bedrock": "*",
    "@aws-sdk/client-sts": "*",
    "@aws-sdk/credential-provider-node": "*",
    "@aws-sdk/credential-providers": "*",
    "@azure/identity": "*",
    "@commander-js/extra-typings": "12",
    "@growthbook/growthbook": "*",
    "@modelcontextprotocol/sdk": "*",
    "@opentelemetry/api": "*",
    "@opentelemetry/api-logs": "*",
    "@opentelemetry/core": "*",
    "@opentelemetry/exporter-logs-otlp-grpc": "*",
    "@opentelemetry/exporter-logs-otlp-http": "*",
    "@opentelemetry/exporter-logs-otlp-proto": "*",
    "@opentelemetry/exporter-metrics-otlp-grpc": "*",
    "@opentelemetry/exporter-metrics-otlp-http": "*",
    "@opentelemetry/exporter-metrics-otlp-proto": "*",
    "@opentelemetry/exporter-prometheus": "*",
    "@opentelemetry/exporter-trace-otlp-grpc": "*",
    "@opentelemetry/exporter-trace-otlp-http": "*",
    "@opentelemetry/exporter-trace-otlp-proto": "*",
    "@opentelemetry/resources": "*",
    "@opentelemetry/sdk-logs": "*",
    "@opentelemetry/sdk-metrics": "*",
    "@opentelemetry/sdk-trace-base": "*",
    "@opentelemetry/semantic-conventions": "*",
    "@smithy/core": "*",
    "@smithy/node-http-handler": "*",
    "ajv": "*",
    "asciichart": "*",
    "auto-bind": "*",
    "axios": "*",
    "bidi-js": "*",
    "cacache": "*",
    "chalk": "*",
    "chokidar": "*",
    "cli-boxes": "*",
    "cli-highlight": "*",
    "code-excerpt": "*",
    "commander": "12",
    "diff": "*",
    "emoji-regex": "*",
    "env-paths": "*",
    "execa": "*",
    "fflate": "*",
    "figures": "*",
    "fuse.js": "*",
    "get-east-asian-width": "*",
    "google-auth-library": "*",
    "highlight.js": "*",
    "https-proxy-agent": "*",
    "ignore": "*",
    "indent-string": "*",
    "ink": "*",
    "jsonc-parser": "*",
    "lodash-es": "*",
    "lru-cache": "*",
    "marked": "*",
    "p-map": "*",
    "picomatch": "*",
    "plist": "*",
    "proper-lockfile": "*",
    "qrcode": "*",
    "react": "*",
    "react-reconciler": "*",
    "semver": "*",
    "sharp": "*",
    "shell-quote": "*",
    "signal-exit": "*",
    "stack-utils": "*",
    "strip-ansi": "*",
    "supports-hyperlinks": "*",
    "tree-kill": "*",
    "turndown": "*",
    "type-fest": "*",
    "undici": "*",
    "usehooks-ts": "*",
    "vscode-jsonrpc": "*",
    "vscode-languageserver-protocol": "*",
    "vscode-languageserver-types": "*",
    "wrap-ansi": "*",
    "ws": "*",
    "xss": "*",
    "yaml": "*",
    "zod": "*"
  },
  "devDependencies": {
    "@types/diff": "*",
    "@types/lodash-es": "*",
    "@types/node": "*",
    "@types/react": "*",
    "@types/semver": "*",
    "@types/shell-quote": "*",
    "@types/ws": "*",
    "bun-types": "*",
    "typescript": "*"
  }
}
EOF
```

**Важно**: Commander должен быть версии 12. Версии 13+ ломают короткий флаг `-d2e` (используется для `--debug-to-stderr`).

## 4. Создание tsconfig.json

```bash
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "baseUrl": ".",
    "paths": {
      "bun:bundle": ["./src/types/bun-bundle.d.ts"],
      "src/*": ["./src/*"]
    },
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
EOF
```

Ключевой момент — `"src/*": ["./src/*"]` в paths. Исходники используют `from 'src/utils/...'` как абсолютные импорты, и Bun разрешает их через tsconfig paths.

## 5. Создание stub-файлов

Ряд модулей отсутствует в утечке (внутренние пакеты Anthropic, нативные модули, файлы за feature-флагами). Для них нужны заглушки.

### 5.1 Тип для bun:bundle

```bash
mkdir -p src/types
cat > src/types/bun-bundle.d.ts << 'EOF'
declare module "bun:bundle" {
  export function feature(name: string): boolean;
}
EOF
```

### 5.2 Нативные/внутренние npm-модули (в node_modules)

После `bun install` (шаг 6), создать:

```bash
# @anthropic-ai/sandbox-runtime
mkdir -p node_modules/@anthropic-ai/sandbox-runtime
cat > node_modules/@anthropic-ai/sandbox-runtime/index.js << 'EOF'
class SandboxManager {
  static isSupportedPlatform() { return false; }
  static isSandboxingEnabled() { return false; }
  static isAutoAllowBashIfSandboxedEnabled() { return false; }
  static getFsWriteConfig() { return { allowOnly: [], denyWithinAllow: [] }; }
  static getFsReadConfig() { return { allowOnly: [], denyWithinAllow: [] }; }
  static getNetworkRestrictionConfig() { return { allowOnly: [] }; }
  static getIgnoreViolations() { return {}; }
  static getProxyPort() { return undefined; }
  static getSocksProxyPort() { return undefined; }
  static getLinuxHttpSocketPath() { return undefined; }
  static getLinuxSocksSocketPath() { return undefined; }
  static getAllowUnixSockets() { return false; }
  static getAllowLocalBinding() { return false; }
  static getEnableWeakerNestedSandbox() { return false; }
  static getLinuxGlobPatternWarnings() { return []; }
  static getExcludedCommands() { return []; }
  static async waitForNetworkInitialization() { return false; }
  static async initialize() {}
  static updateConfig() {}
  static setSandboxSettings() {}
  static wrapWithSandbox(cmd) { return cmd; }
  static refreshConfig() {}
  static reset() {}
  static checkDependencies() { return { satisfied: true, missing: [] }; }
  static getSandboxViolationStore() { return new SandboxViolationStore(); }
  static annotateStderrWithSandboxFailures() {}
  static cleanupAfterCommand() {}
}
class SandboxViolationStore {
  getViolations() { return []; }
  clear() {}
}
const SandboxRuntimeConfigSchema = {
  parse: (v) => v,
  safeParse: (v) => ({ success: true, data: v }),
};
module.exports = { SandboxManager, SandboxViolationStore, SandboxRuntimeConfigSchema };
EOF
cat > node_modules/@anthropic-ai/sandbox-runtime/package.json << 'EOF'
{"name":"@anthropic-ai/sandbox-runtime","version":"0.0.0","main":"index.js"}
EOF

# @ant/claude-for-chrome-mcp
mkdir -p node_modules/@ant/claude-for-chrome-mcp
cat > node_modules/@ant/claude-for-chrome-mcp/index.js << 'EOF'
const BROWSER_TOOLS = [
  { name: 'tabs_context_mcp' }, { name: 'tabs_create_mcp' },
  { name: 'navigate' }, { name: 'read_page' },
  { name: 'get_page_text' }, { name: 'find' },
  { name: 'computer' }, { name: 'form_input' },
  { name: 'javascript_tool' }, { name: 'read_console_messages' },
  { name: 'read_network_requests' }, { name: 'gif_creator' },
  { name: 'resize_window' }, { name: 'upload_image' },
  { name: 'update_plan' }, { name: 'shortcuts_list' },
  { name: 'shortcuts_execute' }, { name: 'switch_browser' },
];
function createClaudeForChromeMcpServer() { return null; }
module.exports = { BROWSER_TOOLS, createClaudeForChromeMcpServer };
EOF
cat > node_modules/@ant/claude-for-chrome-mcp/package.json << 'EOF'
{"name":"@ant/claude-for-chrome-mcp","version":"0.0.0","main":"index.js"}
EOF

# @anthropic-ai/foundry-sdk
mkdir -p node_modules/@anthropic-ai/foundry-sdk
cat > node_modules/@anthropic-ai/foundry-sdk/index.js << 'EOF'
module.exports = { FoundryClient: class {} };
EOF
cat > node_modules/@anthropic-ai/foundry-sdk/package.json << 'EOF'
{"name":"@anthropic-ai/foundry-sdk","version":"0.0.0","main":"index.js"}
EOF

# @anthropic-ai/mcpb
mkdir -p node_modules/@anthropic-ai/mcpb
cat > node_modules/@anthropic-ai/mcpb/index.js << 'EOF'
module.exports = {};
EOF
cat > node_modules/@anthropic-ai/mcpb/package.json << 'EOF'
{"name":"@anthropic-ai/mcpb","version":"0.0.0","main":"index.js"}
EOF

# color-diff-napi (нативный модуль для подсветки диффов)
mkdir -p node_modules/color-diff-napi
cat > node_modules/color-diff-napi/index.js << 'EOF'
class ColorDiff {
  constructor(patch, firstLine, filePath, fileContent) {
    this.patch = patch; this.firstLine = firstLine;
    this.filePath = filePath; this.fileContent = fileContent;
  }
  render(theme, width, dim) { return null; }
}
class ColorFile {
  constructor() {}
  highlight() { return ''; }
}
function getSyntaxTheme() { return {}; }
module.exports = { ColorDiff, ColorFile, getSyntaxTheme };
EOF
cat > node_modules/color-diff-napi/index.mjs << 'EOF'
export class ColorDiff {
  constructor(patch, firstLine, filePath, fileContent) {
    this.patch = patch; this.firstLine = firstLine;
    this.filePath = filePath; this.fileContent = fileContent;
  }
  render(theme, width, dim) { return null; }
}
export class ColorFile {
  constructor() {}
  highlight() { return ''; }
}
export function getSyntaxTheme() { return {}; }
EOF
cat > node_modules/color-diff-napi/package.json << 'EOF'
{"name":"color-diff-napi","version":"0.0.0","main":"index.js","module":"index.mjs","exports":{".":{"import":"./index.mjs","require":"./index.js"}}}
EOF

# modifiers-napi
mkdir -p node_modules/modifiers-napi
cat > node_modules/modifiers-napi/index.js << 'EOF'
module.exports = {};
EOF
cat > node_modules/modifiers-napi/package.json << 'EOF'
{"name":"modifiers-napi","version":"0.0.0","main":"index.js"}
EOF
```

### 5.3 Отсутствующие исходные файлы (в src/)

```bash
# TungstenTool (внутренний инструмент Anthropic)
mkdir -p src/tools/TungstenTool
echo 'export const TungstenTool = null;' > src/tools/TungstenTool/TungstenTool.ts
echo 'export const TungstenLiveMonitor = null;' > src/tools/TungstenTool/TungstenLiveMonitor.ts

# REPLTool
mkdir -p src/tools/REPLTool
echo 'export const REPLTool = null;' > src/tools/REPLTool/REPLTool.ts

# SuggestBackgroundPRTool
mkdir -p src/tools/SuggestBackgroundPRTool
echo 'export const SuggestBackgroundPRTool = null;' > src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.ts

# VerifyPlanExecutionTool
mkdir -p src/tools/VerifyPlanExecutionTool
echo 'export const VerifyPlanExecutionTool = null;' > src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.ts

# WorkflowTool
mkdir -p src/tools/WorkflowTool
echo "export const WORKFLOW_TOOL_NAME = 'WorkflowTool';" > src/tools/WorkflowTool/constants.ts

# SnapshotUpdateDialog
mkdir -p src/components/agents
cat > src/components/agents/SnapshotUpdateDialog.ts << 'EOF'
export const SnapshotUpdateDialog = null;
export const launchSnapshotUpdateDialog = async () => {};
EOF

# AssistantSessionChooser
mkdir -p src/assistant
echo 'export const AssistantSessionChooser = null;' > src/assistant/AssistantSessionChooser.ts

# assistant command
mkdir -p src/commands/assistant
echo 'export default null;' > src/commands/assistant/assistant.ts

# agents-platform command
mkdir -p src/commands/agents-platform
echo 'export default null;' > src/commands/agents-platform/index.ts

# connectorText types
cat > src/types/connectorText.ts << 'EOF'
export type ConnectorText = string;
export type ConnectorTextBlock = { type: 'text'; text: string };
EOF

# contextCollapse service
mkdir -p src/services/contextCollapse
cat > src/services/contextCollapse/index.ts << 'EOF'
export const collapseContext = async () => null;
export const getContextCollapse = () => null;
EOF

# cachedMicrocompact
cat > src/services/compact/cachedMicrocompact.ts << 'EOF'
export type CachedMCState = { cacheEdits: CacheEditsBlock[]; pinnedCacheEdits: PinnedCacheEdits[] };
export type CacheEditsBlock = { type: string; content: any };
export type PinnedCacheEdits = { type: string; content: any };
export const createCachedMCState = (): CachedMCState => ({ cacheEdits: [], pinnedCacheEdits: [] });
export const cachedMicrocompact = async (...args: any[]) => null;
EOF

# protectedNamespace
cat > src/utils/protectedNamespace.ts << 'EOF'
export const protectedNamespaces: string[] = [];
export const isProtectedNamespace = (ns: string) => false;
EOF

# coreTypes.generated
mkdir -p src/entrypoints/sdk
echo 'export type CoreType = any;' > src/entrypoints/sdk/coreTypes.generated.ts

# ink devtools / global.d.ts
echo 'export default {};' > src/ink/devtools.ts
cat > src/ink/global.d.ts << 'EOF'
declare namespace NodeJS {
  interface ProcessEnv { DEV?: string; }
}
EOF

# sdk/runtimeTypes and sdk/toolTypes
cat > src/entrypoints/sdk/runtimeTypes.ts << 'EOF'
export type EffortLevel = 'low' | 'medium' | 'high' | 'auto';
export type RuntimeConfig = Record<string, any>;
EOF
cat > src/entrypoints/sdk/toolTypes.ts << 'EOF'
export type ToolType = string;
export type ToolConfig = Record<string, any>;
EOF

# verify skill markdown files
mkdir -p src/skills/bundled/verify/examples
echo '# Verify Skill' > src/skills/bundled/verify/SKILL.md
echo '# CLI Example' > src/skills/bundled/verify/examples/cli.md
echo '# Server Example' > src/skills/bundled/verify/examples/server.md

# ultraplan prompt
mkdir -p src/utils/ultraplan
echo 'You are an expert planner.' > src/utils/ultraplan/prompt.txt

# filePersistence/types (содержит константы, не только типы)
cat > src/utils/filePersistence/types.ts << 'EOF'
export type TurnStartTime = number;
export type FailedPersistence = { path: string; error: string };
export type FilesPersistedEventData = Record<string, any>;
export type PersistedFile = { path: string; id: string };
export const DEFAULT_UPLOAD_CONCURRENCY = 5;
export const FILE_COUNT_LIMIT = 100;
export const OUTPUTS_SUBDIR = 'outputs';
EOF
```

### 5.4 Автогенерация остальных types.ts

Ряд директорий ожидает `types.ts`, которые не попали в утечку. Скрипт ниже извлекает имена импортов и генерирует stub-файлы:

```bash
generate_types_stub() {
  local dir="$1"
  local types_file="$dir/types.ts"
  [ -f "$types_file" ] && return
  echo "// Auto-generated types stub" > "$types_file"
  grep -rhP "from './types.js'" "$dir/" --include='*.ts' --include='*.tsx' 2>/dev/null | \
    grep -oP '\{\s*[^}]+\}' | tr '{},' '\n' | \
    sed 's/^\s*//;s/\s*$//;s/^type //;s/ as .*$//' | \
    grep -v '^$' | sort -u | while read imp; do
      echo "export type $imp = any;" >> "$types_file"
    done
  echo "Created: $types_file"
}

for dir in \
  src/utils/secureStorage \
  src/components/Spinner \
  src/components/agents/new-agent-creation \
  src/components/wizard \
  src/components/mcp \
  src/keybindings \
  src/services/tips \
  src/services/oauth \
  src/services/lsp \
  src/commands/install-github-app \
  src/commands/plugin; do
  generate_types_stub "$dir"
done
```

## 6. Установка зависимостей

```bash
bun install
```

Установится ~510 пакетов. После этого выполнить шаг 5.2 (создание stubs в node_modules).

## 7. Установка ripgrep

Claude Code использует ripgrep для поиска по файлам. Нужно установить его и создать симлинк туда, где CLI его ожидает:

```bash
# Ubuntu/Debian
apt-get install -y ripgrep

# После сборки (шаг 8) — создать симлинк
mkdir -p dist/vendor/ripgrep/x64-linux
ln -sf $(which rg) dist/vendor/ripgrep/x64-linux/rg
```

## 8. Сборка

Все 7 MACRO-констант должны быть определены через `--define`, иначе будет runtime-ошибка `MACRO is not defined`:

```bash
bun build src/entrypoints/cli.tsx \
  --target=bun \
  --outdir=dist \
  --define 'MACRO.VERSION="1.0.34"' \
  --define 'MACRO.BUILD_TIMESTAMP="2026-03-31"' \
  --define 'MACRO.BUILD_TIME="2026-03-31T12:00:00Z"' \
  --define 'MACRO.FEEDBACK_CHANNEL="#claude-code-feedback"' \
  --define 'MACRO.ISSUES_EXPLAINER="https://github.com/anthropics/claude-code/issues"' \
  --define 'MACRO.NATIVE_PACKAGE_URL="@anthropic-ai/claude-code"' \
  --define 'MACRO.PACKAGE_URL="@anthropic-ai/claude-code"' \
  --define 'MACRO.VERSION_CHANGELOG=""'
```

После сборки — создать симлинк ripgrep (шаг 7).

Результат: `dist/cli.js` (~25MB), ~5880 модулей, сборка за ~1 секунду.

### Параметры сборки

| Параметр | Описание |
|----------|----------|
| Entry point | `src/entrypoints/cli.tsx` (не `src/main.tsx`!) |
| `--target=bun` | Целевой рантайм — Bun |
| `MACRO.VERSION` | Версия. Ставить >= текущей минимальной, иначе CLI откажется запускаться |
| `MACRO.BUILD_TIMESTAMP` | Дата сборки |
| `MACRO.BUILD_TIME` | ISO timestamp сборки |
| `MACRO.FEEDBACK_CHANNEL` | Канал для обратной связи (строка) |
| `MACRO.ISSUES_EXPLAINER` | URL для issues |
| `MACRO.PACKAGE_URL` | npm package name |
| `MACRO.NATIVE_PACKAGE_URL` | npm native package name |
| `MACRO.VERSION_CHANGELOG` | Changelog (можно пустой) |

## 9. Запуск

### С Anthropic API (напрямую)

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
bun run dist/cli.js
```

### С Z.AI (GLM через Anthropic-совместимый прокси)

Z.AI требует Bearer-аутентификацию через `ANTHROPIC_AUTH_TOKEN`. При этом `ANTHROPIC_API_KEY` тоже нужно установить (для конструктора SDK):

```bash
export ANTHROPIC_API_KEY="your_zai_api_key"
export ANTHROPIC_AUTH_TOKEN="your_zai_api_key"
export ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"
export API_TIMEOUT_MS="3000000"
export ANTHROPIC_MODEL="GLM-4.7"
bun run dist/cli.js
```

Или через `~/.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "your_zai_api_key",
    "ANTHROPIC_AUTH_TOKEN": "your_zai_api_key",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000",
    "ANTHROPIC_MODEL": "GLM-4.7"
  }
}
```

### Полезные флаги

```bash
bun run dist/cli.js --version          # Показать версию
bun run dist/cli.js --help             # Справка по флагам
bun run dist/cli.js -p "Hello"         # Pipe-режим (ответ и выход)
bun run dist/cli.js --model sonnet     # Указать модель
bun run dist/cli.js -d                 # Debug-режим
```

### Обход проверки версии

Если CLI блокирует запуск из-за проверки минимальной версии (remote config от Anthropic), есть два способа:

1. **Пересобрать с высокой версией**: `--define 'MACRO.VERSION="99.0.0"'`
2. **Переменная окружения**: `NODE_ENV=test bun run dist/cli.js` — отключает `assertMinVersion()` полностью

### Обёртка для удобства

```bash
cat > /usr/local/bin/claude-dev << 'EOF'
#!/bin/bash
export PATH=$HOME/.bun/bin:$PATH
cd /root/claude-code
exec bun run dist/cli.js "$@"
EOF
chmod +x /usr/local/bin/claude-dev
```

## Ограничения

- **Нет синтаксической подсветки диффов** — `color-diff-napi` это нативный C++ модуль Anthropic, заменён заглушкой
- **Feature flags отключены** — `bun:bundle` `feature()` возвращает `false` для всех флагов. Голосовой режим, BRIDGE_MODE, PROACTIVE и ~80 других фич не работают
- **Внутренние инструменты** (TungstenTool, REPLTool, SuggestBackgroundPRTool, VerifyPlanExecutionTool) заменены null-заглушками
- **Sandbox** отключён — `SandboxManager.isSandboxingEnabled()` всегда возвращает `false`
- **Телеметрия** — OpenTelemetry инициализируется, но без реальных endpoints данные никуда не уходят
- **Нативные модули** (`modifiers-napi`, `audio-capture-napi`, `image-processor-napi`, `url-handler-napi`) — заглушки

## Архитектура (справочно)

```
src/entrypoints/cli.tsx    → Bootstrap: проверка версии, быстрые пути (--version)
  └─ src/main.tsx          → Commander.js CLI, регистрация команд и опций
       ├─ src/QueryEngine.ts    → Ядро: API-вызовы к Anthropic, стриминг, tool-call loop
       ├─ src/tools.ts          → Реестр инструментов (Bash, Edit, Read, Grep, Glob, ...)
       ├─ src/commands.ts       → Реестр slash-команд (/commit, /review, /compact, ...)
       ├─ src/services/         → API, MCP, OAuth, LSP, аналитика
       ├─ src/components/       → React/Ink UI-компоненты (~140 штук)
       ├─ src/hooks/            → React hooks (permissions, input, notifications)
       ├─ src/bridge/           → Интеграция с IDE (VS Code, JetBrains)
       └─ src/utils/            → Утилиты (sandbox, settings, shell, model, ...)
```
