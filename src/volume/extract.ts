import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { extract as extractTar } from 'tar';
import { MAX_EXTRACT_BYTES } from '../constants.js';
import { LightRunnerError } from '../errors.js';
import {
  attachReadOnly,
  awaitContainerExit,
  createSeederContainer,
  shellQuote,
  streamEnd,
} from './seeder.js';
import type { ExtractResult, ExtractSpec } from '../types.js';

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

  return streamTarOut(name, workdir, tarScript, spec, hostTo);
}

async function streamTarOut(
  name: string,
  workdir: string,
  script: string,
  spec: ExtractSpec,
  hostTo: string,
): Promise<ExtractResult> {
  const reject = (error: string): ExtractResult => ({
    from: spec.from, to: spec.to, status: 'error', error,
  });

  const container = await createSeederContainer(name, workdir, script);
  const stream = await attachReadOnly(container);

  let bytes = 0;
  let capped = false;
  let stderrBuf = '';

  const stdout = new PassThrough();
  const stderr = new PassThrough();

  stderr.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });
  stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_EXTRACT_BYTES && !capped) {
      capped = true;
      // Tear down the source so we stop receiving bytes; AutoRemove handles
      // the rest. Best-effort - kill may race with container exit harmlessly.
      container.kill().catch(() => { /* swallow */ });
    }
  });

  container.modem.demuxStream(stream, stdout, stderr);

  const extractor = extractTar({ cwd: hostTo });
  let extractorError: Error | null = null;
  const extractorDone = new Promise<void>((resolve) => {
    extractor.on('error', (err: Error) => { extractorError = err; resolve(); });
    extractor.on('finish', () => resolve());
    extractor.on('close', () => resolve());
  });

  stdout.pipe(extractor);

  // Start AFTER the pipe to extractor and the byte counter are wired. The
  // counter listener puts the PassThrough into flowing mode; if the container
  // produced bytes before the pipe was attached, the extractor would miss the
  // beginning of the tar archive and fail with TAR_BAD_ARCHIVE.
  await container.start();

  await streamEnd(stream);
  // Flush stdout into the extractor before awaiting its completion.
  stdout.end();
  await extractorDone;

  // AutoRemove + race: a 404 from wait() means the container vanished after
  // streaming us the bytes. If the extractor was happy, that's a clean run.
  const rawCode = await awaitContainerExit(container);
  const waitCode = rawCode === -1 ? 0 : rawCode;

  if (capped) return reject(`exceeds ${MAX_EXTRACT_BYTES}-byte cap (streamed)`);
  if (extractorError) return reject(`extract failed: ${(extractorError as Error).message}`);
  if (waitCode !== 0) {
    throw new LightRunnerError({
      code: 'EXTRACT_FAILED',
      message: `tar exited ${waitCode}: ${stderrBuf.trim()}`,
      dockerOp: 'extractFromVolume',
    });
  }
  return { from: spec.from, to: spec.to, status: 'ok', bytes };
}

// Preflight only - any failure here surfaces as `EXTRACT_FAILED`.
async function runAlpine(
  name: string,
  workdir: string,
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const container = await createSeederContainer(name, workdir, script);
    const stream = await attachReadOnly(container);

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutBuf = '';
    let stderrBuf = '';
    stdout.on('data', (b: Buffer) => { stdoutBuf += b.toString('utf8'); });
    stderr.on('data', (b: Buffer) => { stderrBuf += b.toString('utf8'); });
    container.modem.demuxStream(stream, stdout, stderr);

    await container.start();

    await streamEnd(stream);
    const code = await awaitContainerExit(container);
    return { code, stdout: stdoutBuf, stderr: stderrBuf };
  } catch (err) {
    return { code: -1, stdout: '', stderr: (err as Error).message };
  }
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
