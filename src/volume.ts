import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { create as createTar, extract as extractTar } from 'tar';
import {
  DEFAULT_IGNORES,
  MAX_EXTRACT_BYTES,
  SEEDER_IMAGE,
  VOLUME_PREFIX,
} from './constants.js';
import type { ExtractResult, ExtractSpec } from './types.js';

export function createVolume(name: string): void {
  const result = spawnSync('docker', ['volume', 'create', name], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`docker volume create failed: ${result.stderr || result.stdout}`);
  }
}

export function destroyVolume(name: string): void {
  spawnSync('docker', ['volume', 'rm', '-f', name], { encoding: 'utf8' });
}

export interface SeedOptions {
  dir: string | undefined;
  workdir: string;
}

export async function seedVolume(name: string, { workdir, dir }: SeedOptions): Promise<void> {
  // Empty volume: skip the seeder container entirely. An empty tar stream
  // makes busybox tar fail with "short read", so we only spawn the seeder
  // when there is actual content to extract.
  if (dir === undefined) return;

  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`dir path not found: ${dir}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`dir path is not a directory: ${dir}`);
  }

  return new Promise((resolve, reject) => {
    const wq = shellQuote(workdir);
    const child = spawn('docker', [
      'run', '--rm', '-i',
      '-v', `${name}:${workdir}`,
      '-w', workdir,
      SEEDER_IMAGE,
      'sh', '-c', `tar xf - -C ${wq} && chmod -R a+rwX ${wq}`,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`seeder exited ${code}: ${stderr}`));
    });
    child.stdin.on('error', () => { /* pipe may close early on tar error */ });

    const tarStream = createTar(
      {
        cwd: resolved,
        portable: true,
        follow: false,
        filter: (p, stat) => {
          // Skip symlinks entirely - a symlink in the seed could point at
          // sensitive host paths that happen to exist in the container rootfs.
          if ((stat as fs.Stats | undefined)?.isSymbolicLink?.()) return false;
          return !p.split('/').some((s) => DEFAULT_IGNORES.has(s));
        },
      },
      ['.'],
    );
    tarStream.on('error', reject);
    tarStream.pipe(child.stdin);
  });
}

export async function extractFromVolume(
  name: string,
  workdir: string,
  specs: ExtractSpec[],
): Promise<ExtractResult[]> {
  const results: ExtractResult[] = [];
  for (const spec of specs) {
    results.push(await extractOne(name, workdir, spec));
  }
  return results;
}

async function extractOne(
  name: string,
  workdir: string,
  spec: ExtractSpec,
): Promise<ExtractResult> {
  const reject = (error: string): ExtractResult => ({
    from: spec.from, to: spec.to, status: 'error', error,
  });

  if (typeof spec.from !== 'string' || spec.from.length === 0) return reject('empty from');
  if (typeof spec.to !== 'string' || spec.to.length === 0) return reject('empty to');
  if (spec.from.split(/[\\/]/).includes('..')) return reject('path traversal rejected (..)');

  const containerPath = spec.from.startsWith('/')
    ? posixNormalize(spec.from)
    : posixNormalize(`${workdir}/${spec.from}`);
  const containerBase = posixBasename(containerPath);
  const containerDir = posixDirname(containerPath);
  if (containerBase === '' || containerBase === '.') return reject('invalid from basename');

  const hostTo = path.resolve(spec.to);
  try {
    fs.mkdirSync(hostTo, { recursive: true });
  } catch (e) {
    return reject(`mkdir to failed: ${(e as Error).message}`);
  }

  const pathQuoted = shellQuote(containerPath);
  // Preflight: existence + size + type. Emits "dir\n<size>" or "file\n<size>".
  const preScript =
    `if [ ! -e ${pathQuoted} ]; then exit 42; fi; ` +
    `size=$(du -sb ${pathQuoted} | cut -f1); ` +
    `if [ "$size" -gt ${MAX_EXTRACT_BYTES} ]; then exit 43; fi; ` +
    `if [ -d ${pathQuoted} ]; then echo dir; else echo file; fi; ` +
    `echo "$size"`;

  const pre = await runAlpine(name, workdir, preScript);
  if (pre.code === 42) return { from: spec.from, to: spec.to, status: 'missing' };
  if (pre.code === 43) return reject(`exceeds ${MAX_EXTRACT_BYTES}-byte cap`);
  if (pre.code !== 0) return reject(`preflight failed (${pre.code}): ${pre.stderr.trim()}`);
  const fromKind = pre.stdout.trim().split('\n')[0];
  const isDir = fromKind === 'dir';

  // Dir: archive the contents directly (no basename wrap) -> they land under to/.
  // File: archive the file under its basename -> lands as to/basename(from).
  const tarScript = isDir
    ? `cd ${pathQuoted} && tar c .`
    : `cd ${shellQuote(containerDir)} && tar c ${shellQuote(containerBase)}`;

  return new Promise<ExtractResult>((resolve) => {
    const child = spawn('docker', [
      'run', '--rm',
      '-v', `${name}:${workdir}`,
      SEEDER_IMAGE,
      'sh', '-c', tarScript,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let bytes = 0;
    let capped = false;
    let stderrBuf = '';
    let dockerCode: number | null = null;
    let extractorDone = false;
    let extractorError: Error | null = null;

    child.stderr.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_EXTRACT_BYTES && !capped) {
        capped = true;
        child.kill('SIGKILL');
      }
    });

    const extractor = extractTar({ cwd: hostTo, strict: true });
    extractor.on('error', (err: Error) => { extractorError = err; });
    extractor.on('close', () => { extractorDone = true; tryResolve(); });
    extractor.on('finish', () => { extractorDone = true; tryResolve(); });

    child.stdout.pipe(extractor);
    child.on('error', (err) => { extractorError = extractorError ?? err; tryResolve(); });
    child.on('close', (code) => { dockerCode = code ?? -1; tryResolve(); });

    function tryResolve(): void {
      if (dockerCode === null || !extractorDone) return;
      if (capped) return resolve(reject(`exceeds ${MAX_EXTRACT_BYTES}-byte cap (streamed)`));
      if (extractorError) return resolve(reject(`extract failed: ${extractorError.message}`));
      if (dockerCode !== 0) return resolve(reject(`tar exited ${dockerCode}: ${stderrBuf.trim()}`));
      resolve({ from: spec.from, to: spec.to, status: 'ok', bytes });
    }
  });
}

function runAlpine(
  name: string,
  workdir: string,
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn('docker', [
      'run', '--rm',
      '-v', `${name}:${workdir}`,
      SEEDER_IMAGE,
      'sh', '-c', script,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    c.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    c.on('error', () => resolve({ code: -1, stdout, stderr }));
    c.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function posixNormalize(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    parts.push(seg);
  }
  return (p.startsWith('/') ? '/' : '') + parts.join('/');
}

function posixBasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

export function cleanupOrphanVolumes(): number {
  const list = spawnSync('docker', ['volume', 'ls', '-q', '--filter', `name=${VOLUME_PREFIX}`], {
    encoding: 'utf8',
  });
  if (list.status !== 0) return 0;
  const names = list.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  let removed = 0;
  for (const name of names) {
    const rm = spawnSync('docker', ['volume', 'rm', name], { encoding: 'utf8' });
    if (rm.status === 0) removed += 1;
  }
  return removed;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
