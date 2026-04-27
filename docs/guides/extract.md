# Extract files

`extract` is the **only output channel** for files. Logs go to `onLog`, exit code goes to `result.exitCode`, structured output goes through stdout / extracted files. The library has no opinion on what your container does inside.

## Basic usage

```ts
const execution = runner.run({
  image: 'node:lts-alpine',
  command: 'node build.js',
  dir: './project',
  extract: [
    { from: '/app/dist',         to: './out' },  // folder, recursive
    { from: '/app/report.pdf',   to: './out' },  // single file
    { from: '/app/maybe-missing', to: './out' }, // missing -> reported, run still succeeds
  ],
});

const result = await execution.result;
console.log(result.extracted);
// [
//   { from: '/app/dist',          to: './out', status: 'ok',      bytes: 124583 },
//   { from: '/app/report.pdf',    to: './out', status: 'ok',      bytes: 9421 },
//   { from: '/app/maybe-missing', to: './out', status: 'missing' },
// ]
```

## Folder vs file semantics (rsync-like)

| `from` is a... | Result |
|---|---|
| **Folder** | The **contents** of the folder land **directly in `to`** (no basename wrap). Equivalent to `rsync -a from/ to/` or `cp -r from/. to/`. All subdirectories and files are included recursively. |
| **File** | The file lands as `to/basename(from)`. |

Trailing slash is irrelevant: `'/app/dist'` and `'/app/dist/'` produce identical output.

```ts
extract: [
  { from: '/app/dist',       to: './out' },  // /app/dist/a.js     -> ./out/a.js
  { from: '/app/dist/',      to: './out' },  // same as above
  { from: '/app/report.pdf', to: './out' },  //                    -> ./out/report.pdf
]
```

`to` is always a **destination directory**. It is auto-created via `fs.mkdirSync(to, { recursive: true })`.

## Result statuses

Each `extract` entry produces one `ExtractResult`:

| `status`    | Meaning                                                  |
|-------------|----------------------------------------------------------|
| `'ok'`      | Archived and extracted. `bytes` reports the archive size.|
| `'missing'` | `from` does not exist in the container.                  |
| `'error'`   | Cap exceeded, path traversal, mkdir failed, etc. The `error` field carries the reason. |

A missing or errored entry **never fails the run**. The consumer inspects `result.extracted` and decides what to do.

## Hard rules

- **Path traversal rejected**: any segment containing `..` is refused before any container is spawned. `extract: [{ from: '/app/../etc/passwd', ... }]` → `status: 'error'` with `error: 'path traversal rejected (..)'`.
- **Symlinks skipped**: a malicious container could craft a symlink whose target path exists on the host. The tar reader silently drops them.
- **1 GiB per-entry cap**: enforced both **pre-flight** (`du -sb` inside the container) and **streamed** (byte counter in the host pipe). Above that, the entry is reported as `error` and the run still succeeds.
- **Extract only on success**: skipped when `exitCode !== 0` or the run was cancelled. `result.extracted` is undefined in those cases.
- **Disk-to-disk streaming**: the host never buffers the archive in Node RAM.

## How extraction works internally

1. After your container exits with code `0`, the runner spawns a **throwaway Alpine** sidecar with the same volume mounted read-only (no need to keep your image alive).
2. A pre-flight script checks that `from` exists, computes its byte size with `du -sb`, refuses if over the cap.
3. The sidecar runs `tar c` on `from` and pipes the archive to the host through a hijacked Docker stream.
4. The host pipes that into the [`tar` extract](https://www.npmjs.com/package/tar) reader, which writes files into `to/` and counts bytes for the streamed cap check.
5. The sidecar exits, AutoRemove tears it down, the runner returns `result.extracted`.

## Common patterns

### Capture structured output

Have the container write a JSON file, extract it, parse it on the host:

```ts
// Inside the container:
//   import json
//   json.dump({'fib': fib(20)}, open('/app/result.json', 'w'))

const result = await runner.run({
  image: 'python:3.12-alpine',
  command: 'python main.py',
  dir: './solver',
  extract: [{ from: '/app/result.json', to: './out' }],
}).result;

const data = JSON.parse(fs.readFileSync('./out/result.json', 'utf8'));
```

### Pull a build artefact

```ts
extract: [
  { from: '/app/dist',        to: './public' },
  { from: '/app/coverage',    to: './reports' },
],
```

### Tolerate optional outputs

Multiple entries with one missing is fine:

```ts
extract: [
  { from: '/app/required.json',   to: './out' },
  { from: '/app/optional-extra',  to: './out' },  // may not exist
]

const result = await execution.result;
const required = result.extracted!.find(e => e.from === '/app/required.json');
if (required?.status !== 'ok') throw new Error('required.json missing');
```

## See also

- [`ExtractSpec`](/api/interfaces/ExtractSpec) and [`ExtractResult`](/api/interfaces/ExtractResult) in the API reference
- [Security model](./security) — why symlinks and `..` segments are dropped
