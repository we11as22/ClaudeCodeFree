import { mkdir, symlink, unlink } from 'fs/promises'
import { dirname, resolve } from 'path'

const ripgrepPath = Bun.which('rg')

if (!ripgrepPath) {
  throw new Error('ripgrep (rg) is required to prepare Claude Code build artifacts')
}

const target = resolve('dist/vendor/ripgrep/x64-linux/rg')

await mkdir(dirname(target), { recursive: true })
await unlink(target).catch(() => {})
await symlink(ripgrepPath, target)

console.log(`Linked ripgrep vendor binary: ${target} -> ${ripgrepPath}`)
