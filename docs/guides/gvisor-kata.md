# gVisor & Kata Containers

Default `runtime: 'runc'` shares the host kernel with the container. That is fast and convenient, but it means a kernel-level exploit inside the container can compromise the host. For genuinely hostile code, switch the runtime.

## Choose the right tier

| Runtime | Isolation | Performance | Status in light-runner |
|---|---|---|---|
| `runc` (default) | Linux namespaces + cgroups, shared kernel | Native | **Tested**, default for trusted/known code |
| `runsc` (gVisor) | User-space syscall interception, smaller kernel attack surface | ~10-30% I/O overhead | **Tested**, recommended for hostile code |
| `kata` (Kata Containers) | Lightweight VM per container, separate kernel | ~5-15% boot + I/O cost | **Option exposed but not yet validated in our test matrix** — open an issue if you run it in production |

Switch via `RunnerOptions`:

```ts
const runner = new DockerRunner({ runtime: 'runsc' });  // or 'kata'
```

When the option is `runc` (or omitted), the runner does not pass a `Runtime` field to Docker, so you keep whatever the daemon's default is.

## When to use gVisor

Use it when **any** of these is true:

- The code you run is **anonymous** (random user uploads, public CTF entries).
- The code is **AI-generated** and you do not audit each call (LLM tool execution, agent runtimes).
- You ship a **multi-tenant playground** and one tenant compromising the host would be a headline.
- You handle PII or regulated data and the threat model includes "the running code is the adversary".

You do **not** need gVisor when:

- The code comes from your own CI / internal tooling and you trust the toolchain.
- You build the image yourself from a known Dockerfile.
- The performance cost is unacceptable (data-intensive batch jobs).

## Install gVisor on Linux / WSL2

gVisor does **not** run natively on macOS or Windows. On Windows, use Docker Desktop with the **WSL2 backend** — the `runsc` install lives inside the WSL2 distro, not the Windows host.

```bash
(
  set -e
  ARCH=$(uname -m)
  URL=https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}
  wget ${URL}/runsc ${URL}/runsc.sha512 \
       ${URL}/containerd-shim-runsc-v1 ${URL}/containerd-shim-runsc-v1.sha512
  sha512sum -c runsc.sha512 -c containerd-shim-runsc-v1.sha512
  rm -f *.sha512
  chmod a+rx runsc containerd-shim-runsc-v1
  sudo mv runsc containerd-shim-runsc-v1 /usr/local/bin
)
sudo /usr/local/bin/runsc install
sudo systemctl reload docker
```

`latest` is a rolling channel — gVisor ships frequent date-stamped releases (`release-YYYYMMDD.N`), no semantic version. Verify with `runsc --version`.

After the daemon reload, test that Docker accepts the new runtime:

```bash
docker run --rm --runtime=runsc alpine:3.19 dmesg | head
# Expect: gVisor-style kernel ring buffer, NOT the host's
```

Then in your code:

```ts
const runner = new DockerRunner({ runtime: 'runsc' });
```

## Performance notes

`runsc` intercepts syscalls in user space, so it pays a tax on every syscall:

| Workload                          | Approx. overhead vs runc |
|---|---|
| CPU-bound (no syscalls)           | ~0%                      |
| Read-heavy I/O                    | 10-15%                   |
| Write-heavy I/O                   | 20-30%                   |
| Network-heavy (small packets)     | 25-40%                   |
| Workloads spawning many processes | 30-50%                   |

For agent-style runs (one container, one process tree, one set of files), the overhead is usually **invisible**. For tight inner loops on disk or network, benchmark before committing.

## Kata Containers

Kata runs each container inside a lightweight VM with its own kernel, giving you **VM-level isolation** at container-level UX.

```ts
const runner = new DockerRunner({ runtime: 'kata' });
```

We pass `runtime: 'kata'` straight through to Docker's `HostConfig.Runtime`. Docker then dispatches to whichever Kata shim is installed (`containerd-shim-kata-v2` or similar). The library does **not** validate that the runtime is installed; if it is missing, Docker returns a `CONTAINER_START_FAILED` error at run time.

**The disclaimer** (also visible on the security note in the bespoke landing): we expose this option for users who already run Kata, but our CI does **not** install or test against Kata. If you adopt it in production, please open an issue with results — both successes and edge cases.

Useful resources:

- [Kata Containers project](https://github.com/kata-containers/kata-containers)
- [Docker + Kata setup guide](https://github.com/kata-containers/kata-containers/blob/main/docs/install/docker/ubuntu-docker-install.md)

## Verifying isolation

A quick sanity check that the runtime actually changed:

```ts
const result = await runner.run({
  image: 'alpine:3.19',
  command: 'cat /proc/self/maps | head -5',
  // gVisor-mapped binaries look very different from runc-mapped ones
}).result;
```

Or look for the gVisor signature:

```ts
const result = await runner.run({
  image: 'alpine:3.19',
  command: 'dmesg | grep -i gvisor || echo "not gvisor"',
}).result;
```

Under `runsc` you will see `gVisor` strings in `dmesg`. Under `runc`, you will see the host's kernel ring buffer.

## Trade-offs summary

| Want... | Use |
|---|---|
| Maximum speed, you trust the code | `runc` (default) |
| Hard barrier against kernel exploits, willing to pay 10-30% I/O | `runsc` |
| Full VM isolation, separate kernel | `kata` (un-validated, at your own risk) |
| Air-gapped network on top of any of the above | `network: 'none'` on the request |
