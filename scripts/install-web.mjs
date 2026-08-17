#!/usr/bin/env node
/**
 * One-command installer for the dsh web profile.
 *
 *   node scripts/install-web.mjs [--profile <name>]   (default profile: web)
 *
 * Steps:
 *   1. Installs the package into the harness checkout root:
 *        pnpm add -w github:BroBFG/dsh-tool-docx
 *      The package ships its built lib/ (no prepare script), so no
 *      `allowBuilds` entry is needed in the harness pnpm-workspace.yaml.
 *   2. Writes the mount rows from this package's cordis.patch.yml into the
 *      profile's patch layer ($DSH_HOME/profiles/<name>/cordis.patch.yml),
 *      idempotently — existing rows are preserved.
 *   3. Prints the restart hint.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_DIR = fileURLToPath(new URL('.', import.meta.url))
const MOUNT_BLOCK = readFileSync(join(SELF_DIR, '..', 'cordis.patch.yml'), 'utf8').trim()
// On Windows pnpm is a .cmd shim; Node cannot spawn it directly, so it goes
// through cmd.exe (same as the harness launcher does).
function runPnpm(args) {
  return process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { stdio: 'inherit' })
    : spawnSync('pnpm', args, { stdio: 'inherit' })
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function main() {
  const args = process.argv.slice(2)
  const profile = (args[0] === '--profile' ? args[1] : undefined) ?? 'web'

  // 1. Install the package into the harness checkout (cwd).
  console.log('[dsh-tool-docx] installing github:BroBFG/dsh-tool-docx into the harness checkout…')
  const install = runPnpm(['add', '-w', 'github:BroBFG/dsh-tool-docx'])
  if (install.error || install.status !== 0) {
    console.error(`[dsh-tool-docx] pnpm add failed${install.error ? ` (${install.error.message})` : ''}; run it manually:  pnpm add -w github:BroBFG/dsh-tool-docx`)
    process.exit(install.status ?? 1)
  }

  // 2. Write the mount rows into the profile's patch layer.
  const patchPath = join(dshHome(), 'profiles', profile, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    console.error(`[dsh-tool-docx] profile patch not found: ${patchPath}`)
    console.error('  Boot the harness once first (pnpm dsh web), then re-run this installer.')
    process.exit(1)
  }
  const existing = readFileSync(patchPath, 'utf8')
  if (existing.includes('dsh-tool-docx')) {
    console.log(`[dsh-tool-docx] already mounted in ${patchPath} — nothing to change`)
  } else if (existing.trim() === '[]') {
    writeFileSync(patchPath, `${MOUNT_BLOCK}\n`)
    console.log(`[dsh-tool-docx] mounted in ${patchPath}`)
  } else {
    writeFileSync(patchPath, `${existing.trimEnd()}\n\n${MOUNT_BLOCK}\n`)
    console.log(`[dsh-tool-docx] appended mount rows to ${patchPath}`)
  }

  // 3. Restart hint.
  console.log('[dsh-tool-docx] done. Restart the harness (Ctrl+C, then `pnpm dsh web`) to load the docx tools.')
}

main()
