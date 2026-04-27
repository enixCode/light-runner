# Security model

`light-runner` is the boring, correct, library-grade answer to "how do I run untrusted code in a container from Node.js?". It is **secure by default**, **additive only** (every option makes the sandbox stronger, never weaker), and it has **one job** (no orchestration, no networking, no persistence beyond the run).

This page describes what is in scope, what is not, and how to choose the right hardening tier.

## Threat model

| In scope                                                                 | Out of scope                                       |
|---|---|
| Untrusted **user code** running inside the container                    | The host kernel itself (use gVisor for hostile code) |
| **Filesystem isolation** between the run and the host                   | Side-channel attacks (timing, cache, Spectre)      |
| **Process isolation** between sibling runs on the same host             | Hardware-level threats (firmware, BIOS)            |
| **Network containment** between the run and the host network            | The Docker socket itself (root-equivalent on host) |
| **Resource starvation** (memory, CPU, pids, extract size)               | DoS at the orchestration layer (caller's job)      |
| Common container-escape patterns: raw sockets, mknod, capability juggling | Multi-tenant isolation **between tenants** sharing one container |

**The one rule**: one run, one container, one tenant. If two pieces of code must not see each other, they each get their own `runner.run(...)` call.

## What is on by default

Every flag in [`src/createOptions.ts`](https://github.com/enixCode/light-runner/blob/main/src/createOptions.ts) is on for every run, with no opt-out path.

### Capabilities dropped

The following Linux capabilities are stripped at startup:

| Capability     | Why                                                        |
|----------------|------------------------------------------------------------|
| `NET_RAW`      | Raw / packet sockets (ARP spoofing, packet crafting)       |
| `MKNOD`        | Fabricate device nodes                                     |
| `SYS_CHROOT`   | Escape weaker chroot jails                                 |
| `SETPCAP`      | Modify capability sets of other processes                  |
| `SETFCAP`      | Escalate via setcap on dropped binaries                    |
| `AUDIT_WRITE`  | Kernel audit log flooding / spoofing                       |

### `no-new-privileges`

A `setuid` binary inside the container **cannot elevate above the user it starts as**. Even if the image ships a legitimate-looking root-suid helper, it stays at the run user's privilege level.

### Process cap

`PidsLimit: 100` per container. A fork-bomb caps out in milliseconds instead of paging the host. Tunable upward via `RunnerOptions` if you genuinely need more (compilers spawning many processes, orchestrators-of-orchestrators), but the floor is conservative.

### Memory and CPU budget

`512 MiB` and `1` core by default, **cgroup-enforced**. Noisy runs cannot starve their neighbours. Override with `new DockerRunner({ memory: '4g', cpus: '4' })`.

### Network isolation

Default network: a **dedicated isolated bridge** (`light-runner-isolated`) with **inter-container traffic disabled** (`com.docker.network.bridge.enable_icc: false`). Outbound internet works; sibling runs on the same bridge cannot see each other.

For air-gapped runs, set `network: 'none'` in the request — the container has no network interface at all.

### Filesystem protections

- **Symlinks in your input folder are filtered** at seed time, so a stray `.git` link or a deliberate symlink to `/etc/passwd` cannot cross the host -> container boundary.
- **`DEFAULT_IGNORES`** (`.git`, `node_modules`, `dist`, `build`, `.next`, `.cache`, `.turbo`, `coverage`) are skipped during seeding. They are noise at best and credentials-bearing at worst.
- **Path traversal in `extract.from`** (segments containing `..`) is rejected **before** any container is spawned. A malicious container cannot tell the host extractor to write to `/etc/cron.d/`.
- **Extract symlinks are skipped** during streaming. A container cannot craft a tarball with a symlink that resolves to a host path.
- **Extract cap**: 1 GiB per entry, enforced **twice** — pre-flight via `du -sb` inside the container, and streamed via a byte counter on the host pipe.

## What this does not cover

- **Kernel exploits** (anything that breaks out of namespaces by tickling the host kernel directly).
- **`runc` CVEs** (rare but real; you eat them if you ship `runtime: 'runc'`).
- **Side-channel attacks** (timing, cache eviction, Spectre/Meltdown family).

For genuinely hostile code (anonymous user-submitted source, AI-agent-generated tool calls, a CTF playground), combine with a stronger runtime — see [gVisor & Kata](./gvisor-kata).

## Secrets

`env` vars go to `docker run --env`, which makes them visible in `docker inspect` and Docker metadata. That is fine in most setups (a host with Docker socket access is already root-equivalent), but for sensitive material prefer:

- **`input`** (stdin). Ephemeral. Not in metadata, not in `docker inspect`. Your container reads it via `sys.stdin.read()` / `process.stdin`.
- **A bind mount to `/run/secrets/<name>`**. Docker-native file-based secrets pattern (compose has a `secrets:` block for this). Not managed by light-runner — the consumer wires it via the host config or via a parent compose definition.

Avoid putting API keys in `env`. Avoid putting them in `command`. Avoid putting them in `dir` (they would be tarred into the seed archive and visible to anyone with access to the volume).

## Hardening recipes

### Air-gapped run (no network, untrusted source code)

```ts
const runner = new DockerRunner();
runner.run({
  image: 'python:3.12-alpine',
  command: 'python untrusted.py',
  dir: './sandbox',
  network: 'none',
  timeout: 30_000,
  extract: [{ from: '/app/output.json', to: './out' }],
});
```

### Tighter resource budget

```ts
const runner = new DockerRunner({
  memory: '128m',
  cpus: '0.5',
});
```

### Maximum isolation (gVisor)

```ts
const runner = new DockerRunner({ runtime: 'runsc' });
```

See [gVisor & Kata](./gvisor-kata) for installation.

## Reporting a security issue

Email the maintainer (see GitHub profile) with `[security]` in the subject. Public issues are fine for things that need a fix but no one is exploiting; private disclosure is preferred for actively-exploitable bugs.
