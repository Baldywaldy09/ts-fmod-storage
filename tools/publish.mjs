#!/usr/bin/env node
// Publishes a plugin build into this repo and updates manifest.json.
//
//   node tools/publish.mjs plugin <stage-dir> [--notes "text"] [--channel stable|beta]
//   node tools/publish.mjs app <version> [--notes "text"] [--url <download url>]
//   node tools/publish.mjs notice <id> <info|warn|danger> <title> <body> [--until 2026-12-31]
//   node tools/publish.mjs verify
//
// <stage-dir> is the plugin's CMake stage folder (plugin/build/stage/plugins): it holds
// ts-fmod-plugin-v2.dll and ts-fmod-plugin-v2/. The version is read from the DLL itself.

import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'manifest.json')
const DLL = 'ts-fmod-plugin-v2.dll'
// Only what the plugin ships: never a user's banks, settings or logs from a dev stage folder
const SHIPPED = [DLL, 'ts-fmod-plugin-v2/builtin/']

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, 'utf8'))
  } catch {
    return {
      $schema: './schema/manifest.schema.json',
      schema: 1,
      updated: null,
      app: null,
      plugin: { channels: { stable: null, beta: null }, releases: [] },
      notices: [],
    }
  }
}

async function saveManifest(manifest) {
  manifest.updated = new Date().toISOString()
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(path)))
    else out.push(path)
  }
  return out
}

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const posix = (path) => path.split(sep).join('/')

// FILEVERSION from VS_FIXEDFILEINFO, found by its signature
async function dllVersion(path) {
  const data = await readFile(path)
  const at = data.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]))
  if (at < 0) throw new Error(`${path} has no version resource`)
  const ms = data.readUInt32LE(at + 8)
  const ls = data.readUInt32LE(at + 12)
  return [ms >>> 16, ms & 0xffff, ls >>> 16].join('.')
}

// Verified game builds, read from the plugin's version.h when it sits next to the stage folder
async function knownBuilds(stage) {
  const header = join(stage, '..', '..', '..', 'src', 'version.h')
  try {
    const text = await readFile(header, 'utf8')
    return [...text.matchAll(/\{\s*"(\w+)",\s*"([0-9a-f]+)",\s*"([^"]+)"\s*\}/g)].map((m) => ({ game: m[1], build: m[2], label: m[3] }))
  } catch {
    return []
  }
}

async function publishPlugin(stage) {
  const version = await dllVersion(join(stage, DLL))
  const channel = flag('channel') ?? 'stable'
  const base = `plugin/${version}/`
  const target = join(ROOT, base)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })

  const files = []
  for (const path of (await walk(stage)).sort()) {
    const rel = posix(relative(stage, path))
    if (!SHIPPED.some((s) => rel === s || (s.endsWith('/') && rel.startsWith(s)))) continue
    await mkdir(dirname(join(target, rel)), { recursive: true })
    await cp(path, join(target, rel))
    files.push({ path: rel, size: (await stat(path)).size, sha256: await sha256(path) })
  }

  const manifest = await loadManifest()
  const release = {
    version,
    date: new Date().toISOString().slice(0, 10),
    base,
    notes: flag('notes') ?? '',
    verified_builds: await knownBuilds(stage),
    min_app: flag('min-app') ?? '2.0.0',
    files,
  }
  manifest.plugin.releases = [release, ...manifest.plugin.releases.filter((r) => r.version !== version)]
  manifest.plugin.channels[channel] = version
  await saveManifest(manifest)
  console.log(`Published plugin ${version} (${files.length} files) to ${base}, channel ${channel}`)
}

async function publishApp(version) {
  const manifest = await loadManifest()
  manifest.app = {
    version,
    date: new Date().toISOString().slice(0, 10),
    url: flag('url') ?? 'https://github.com/Baldywaldy09/ts-fmod-storage/releases/latest',
    notes: flag('notes') ?? '',
  }
  await saveManifest(manifest)
  console.log(`App ${version} announced`)
}

async function addNotice([id, level, title, body]) {
  if (!id || !level || !title || !body) throw new Error('notice <id> <info|warn|danger> <title> <body>')
  const manifest = await loadManifest()
  manifest.notices = [{ id, level, title, body, until: flag('until') ?? null }, ...manifest.notices.filter((n) => n.id !== id)]
  await saveManifest(manifest)
  console.log(`Notice ${id} saved`)
}

// Every file the manifest lists exists with the size and hash it claims
async function verify() {
  const manifest = await loadManifest()
  let bad = 0
  for (const release of manifest.plugin.releases) {
    for (const file of release.files) {
      const path = join(ROOT, release.base, file.path)
      try {
        const ok = (await stat(path)).size === file.size && (await sha256(path)) === file.sha256
        if (!ok) throw new Error('mismatch')
      } catch (error) {
        bad++
        console.error(`BAD  ${release.base}${file.path}: ${error.message}`)
      }
    }
  }
  console.log(bad ? `${bad} bad file(s)` : 'manifest.json matches every file')
  process.exitCode = bad ? 1 : 0
}

const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) i++
  else positional.push(args[i])
}
const [command, ...rest] = positional
switch (command) {
  case 'plugin':
    await publishPlugin(rest[0] ?? join(ROOT, '..', 'ts-fmod-plugin-v2-remake', 'plugin', 'build', 'stage', 'plugins'))
    break
  case 'app':
    await publishApp(rest[0])
    break
  case 'notice':
    await addNotice(rest)
    break
  case 'verify':
    await verify()
    break
  default:
    console.log('commands: plugin <stage-dir> | app <version> | notice <id> <level> <title> <body> | verify')
}
