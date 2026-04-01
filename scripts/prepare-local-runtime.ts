import { mkdir, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'

async function writeStubFile(path: string, content: string): Promise<void> {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, content)
}

const sandboxRuntimeStub = `export class SandboxViolationStore {
  #violations = []
  #listeners = new Set()

  getViolations() {
    return [...this.#violations]
  }

  getTotalCount() {
    return this.#violations.length
  }

  subscribe(listener) {
    this.#listeners.add(listener)
    listener(this.getViolations())
    return () => {
      this.#listeners.delete(listener)
    }
  }

  clear() {
    this.#violations = []
    for (const listener of this.#listeners) {
      listener(this.getViolations())
    }
  }
}

const sandboxViolationStore = new SandboxViolationStore()

export class SandboxManager {
  static isSupportedPlatform() {
    return false
  }

  static isSandboxingEnabled() {
    return false
  }

  static isAutoAllowBashIfSandboxedEnabled() {
    return false
  }

  static getFsWriteConfig() {
    return { allowOnly: [], denyWithinAllow: [] }
  }

  static getFsReadConfig() {
    return { allowOnly: [], denyWithinAllow: [] }
  }

  static getNetworkRestrictionConfig() {
    return { allowOnly: [] }
  }

  static getIgnoreViolations() {
    return {}
  }

  static getProxyPort() {
    return undefined
  }

  static getSocksProxyPort() {
    return undefined
  }

  static getLinuxHttpSocketPath() {
    return undefined
  }

  static getLinuxSocksSocketPath() {
    return undefined
  }

  static getAllowUnixSockets() {
    return false
  }

  static getAllowLocalBinding() {
    return false
  }

  static getEnableWeakerNestedSandbox() {
    return false
  }

  static getLinuxGlobPatternWarnings() {
    return []
  }

  static getExcludedCommands() {
    return []
  }

  static async waitForNetworkInitialization() {
    return false
  }

  static async initialize() {}

  static updateConfig() {}

  static setSandboxSettings() {}

  static wrapWithSandbox(cmd) {
    return cmd
  }

  static refreshConfig() {}

  static reset() {}

  static checkDependencies() {
    return { satisfied: true, missing: [] }
  }

  static getSandboxViolationStore() {
    return sandboxViolationStore
  }

  static annotateStderrWithSandboxFailures() {}

  static cleanupAfterCommand() {}
}

export const SandboxRuntimeConfigSchema = {
  parse(value) {
    return value
  },
  safeParse(value) {
    return { success: true, data: value }
  },
}
`

await writeStubFile(
  'node_modules/@anthropic-ai/sandbox-runtime/index.js',
  sandboxRuntimeStub,
)
await writeStubFile(
  'node_modules/@anthropic-ai/sandbox-runtime/package.json',
  '{"name":"@anthropic-ai/sandbox-runtime","version":"0.0.0","main":"index.js","type":"module"}\n',
)

await writeStubFile(
  'node_modules/@ant/claude-for-chrome-mcp/index.js',
  `export const BROWSER_TOOLS = [
  { name: 'tabs_context_mcp' },
  { name: 'tabs_create_mcp' },
  { name: 'navigate' },
  { name: 'read_page' },
  { name: 'get_page_text' },
  { name: 'find' },
  { name: 'computer' },
  { name: 'form_input' },
  { name: 'javascript_tool' },
  { name: 'read_console_messages' },
  { name: 'read_network_requests' },
  { name: 'gif_creator' },
  { name: 'resize_window' },
  { name: 'upload_image' },
  { name: 'update_plan' },
  { name: 'shortcuts_list' },
  { name: 'shortcuts_execute' },
  { name: 'switch_browser' },
]

export function createClaudeForChromeMcpServer() {
  return null
}
`,
)
await writeStubFile(
  'node_modules/@ant/claude-for-chrome-mcp/package.json',
  '{"name":"@ant/claude-for-chrome-mcp","version":"0.0.0","main":"index.js","type":"module"}\n',
)

await writeStubFile(
  'node_modules/@anthropic-ai/foundry-sdk/index.js',
  'export class FoundryClient {}\n',
)
await writeStubFile(
  'node_modules/@anthropic-ai/foundry-sdk/package.json',
  '{"name":"@anthropic-ai/foundry-sdk","version":"0.0.0","main":"index.js","type":"module"}\n',
)

await writeStubFile(
  'node_modules/@anthropic-ai/mcpb/index.js',
  'export {}\n',
)
await writeStubFile(
  'node_modules/@anthropic-ai/mcpb/package.json',
  '{"name":"@anthropic-ai/mcpb","version":"0.0.0","main":"index.js","type":"module"}\n',
)

await writeStubFile(
  'node_modules/color-diff-napi/index.js',
  `export class ColorDiff {
  constructor(patch, firstLine, filePath, fileContent) {
    this.patch = patch
    this.firstLine = firstLine
    this.filePath = filePath
    this.fileContent = fileContent
  }

  render() {
    return null
  }
}

export class ColorFile {
  highlight() {
    return ''
  }
}

export function getSyntaxTheme() {
  return {}
}
`,
)
await writeStubFile(
  'node_modules/color-diff-napi/package.json',
  '{"name":"color-diff-napi","version":"0.0.0","main":"index.js","type":"module"}\n',
)

await writeStubFile(
  'node_modules/modifiers-napi/index.js',
  'export {}\n',
)
await writeStubFile(
  'node_modules/modifiers-napi/package.json',
  '{"name":"modifiers-napi","version":"0.0.0","main":"index.js","type":"module"}\n',
)

console.log('Prepared local runtime stubs for leaked Claude Code build')
