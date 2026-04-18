import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DockerRunner } from '../../src/DockerRunner.js';

const dockerAvailable = spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
const maybe = dockerAvailable ? describe : describe.skip;

maybe('real-world language scenarios', () => {
  it('runs a Python script that reads stdin JSON and extracts a result file', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-py-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-py-out-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'main.py'),
        [
          'import sys, json',
          'data = json.loads(sys.stdin.read())',
          'n = int(data.get("n", 10))',
          'a, b = 0, 1',
          'for _ in range(n):',
          '    a, b = b, a + b',
          'out = {"input": n, "fib": a, "sqrt": round(a ** 0.5, 4)}',
          'open("result.json", "w").write(json.dumps(out))',
          '',
        ].join('\n'),
      );
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'python:3.12-alpine',
        command: 'python main.py',
        dir: seedDir,
        input: { n: 20 },
        timeout: 60000,
        network: 'none',
        extract: [{ from: '/app/result.json', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true, `run failed: exit=${result.exitCode}`);
      assert.equal(result.extracted![0].status, 'ok');
      const parsed = JSON.parse(
        fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'),
      ) as { input: number; fib: number; sqrt: number };
      assert.equal(parsed.input, 20);
      assert.equal(parsed.fib, 6765);
      assert.ok(parsed.sqrt > 82 && parsed.sqrt < 83);
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('runs a multi-file Python project and extracts the generated CSV', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-pkg-'));
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-pkg-out-'));
    try {
      fs.mkdirSync(path.join(seedDir, 'lib'));
      fs.writeFileSync(path.join(seedDir, 'lib', '__init__.py'), '');
      fs.writeFileSync(
        path.join(seedDir, 'lib', 'stats.py'),
        [
          'def mean(xs):',
          '    return sum(xs) / len(xs)',
          '',
          'def variance(xs):',
          '    m = mean(xs)',
          '    return sum((x - m) ** 2 for x in xs) / len(xs)',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(seedDir, 'main.py'),
        [
          'import csv, json, os',
          'from lib.stats import mean, variance',
          '',
          'os.makedirs("results", exist_ok=True)',
          'xs = list(range(1, 101))',
          'with open("results/data.csv", "w", newline="") as f:',
          '    w = csv.writer(f)',
          '    w.writerow(["i", "i_sq"])',
          '    for i in xs:',
          '        w.writerow([i, i * i])',
          '',
          'summary = {',
          '    "count": len(xs),',
          '    "mean": mean(xs),',
          '    "variance": round(variance(xs), 4),',
          '}',
          'open("results/summary.json", "w").write(json.dumps(summary))',
          '',
        ].join('\n'),
      );

      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'python:3.12-alpine',
        command: 'python main.py',
        dir: seedDir,
        timeout: 60000,
        network: 'none',
        extract: [{ from: '/app/results', to: extractDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true, `run failed: exit=${result.exitCode}`);
      assert.equal(result.extracted![0].status, 'ok');

      const summary = JSON.parse(
        fs.readFileSync(path.join(extractDir, 'summary.json'), 'utf8'),
      ) as { count: number; mean: number; variance: number };
      assert.equal(summary.count, 100);
      assert.equal(summary.mean, 50.5);
      assert.ok(summary.variance > 800 && summary.variance < 900);

      const csv = fs.readFileSync(
        path.join(extractDir, 'data.csv'), 'utf8',
      );
      // Python csv writes CRLF by spec; split tolerates either.
      const lines = csv.split(/\r?\n/).filter(Boolean);
      assert.equal(lines.length, 101);
      assert.equal(lines[0], 'i,i_sq');
      assert.equal(lines[1], '1,1');
      assert.equal(lines[100], '100,10000');
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('runs a Node script that generates a binary artefact with a matching SHA256', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-node-'));
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-node-out-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'build.js'),
        [
          "const fs = require('fs');",
          "const crypto = require('crypto');",
          "fs.mkdirSync('artefacts/logs', { recursive: true });",
          "const payload = crypto.randomBytes(256 * 1024);",
          "fs.writeFileSync('artefacts/binary.dat', payload);",
          "fs.writeFileSync('artefacts/logs/build.log', 'step1 ok\\nstep2 ok\\n');",
          "fs.writeFileSync('artefacts/report.html', '<!doctype html><p>ok</p>');",
          "const hash = crypto.createHash('sha256').update(payload).digest('hex');",
          "fs.writeFileSync('artefacts/manifest.json', JSON.stringify({ size: payload.length, sha256: hash }));",
          '',
        ].join('\n'),
      );
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'node:20-alpine',
        command: 'node build.js',
        dir: seedDir,
        timeout: 60000,
        network: 'none',
        extract: [{ from: '/app/artefacts', to: extractDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      assert.equal(result.extracted![0].status, 'ok');

      const manifest = JSON.parse(
        fs.readFileSync(path.join(extractDir, 'manifest.json'), 'utf8'),
      ) as { size: number; sha256: string };
      assert.equal(manifest.size, 256 * 1024);
      assert.match(manifest.sha256, /^[a-f0-9]{64}$/);

      const bin = fs.readFileSync(
        path.join(extractDir, 'binary.dat'),
      );
      assert.equal(bin.length, 256 * 1024);
      const gotHash = (await import('node:crypto'))
        .createHash('sha256').update(bin).digest('hex');
      assert.equal(gotHash, manifest.sha256, 'extracted binary must match in-container hash');

      const log = fs.readFileSync(
        path.join(extractDir, 'logs', 'build.log'), 'utf8',
      );
      assert.ok(log.includes('step1 ok'));
      assert.ok(log.includes('step2 ok'));
      const html = fs.readFileSync(
        path.join(extractDir, 'report.html'), 'utf8',
      );
      assert.ok(html.includes('<p>ok</p>'));
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('Python script that raises an exception reports non-zero exit', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-pyerr-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'crash.py'),
        'raise RuntimeError("nope")\n',
      );
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'python:3.12-alpine',
        command: 'python crash.py',
        dir: seedDir,
        timeout: 30000,
        network: 'none',
      });
      const result = await exec.result;
      assert.equal(result.success, false);
      assert.equal(result.exitCode, 1);
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
    }
  });

  it('runs a Go program that reads stdin and writes an output file', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-go-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-go-out-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'main.go'),
        [
          'package main',
          '',
          'import (',
          '    "encoding/json"',
          '    "io"',
          '    "os"',
          ')',
          '',
          'type In struct { N int `json:"n"` }',
          'type Out struct { N int `json:"n"`; Squared int `json:"squared"` }',
          '',
          'func main() {',
          '    data, _ := io.ReadAll(os.Stdin)',
          '    var in In',
          '    json.Unmarshal(data, &in)',
          '    out := Out{N: in.N, Squared: in.N * in.N}',
          '    b, _ := json.Marshal(out)',
          '    os.WriteFile("result.json", b, 0644)',
          '}',
          '',
        ].join('\n'),
      );
      const runner = new DockerRunner({ memory: '1g', cpus: '2' });
      const exec = runner.run({
        image: 'golang:1.22-alpine',
        command: 'go run main.go',
        dir: seedDir,
        input: { n: 7 },
        timeout: 120_000,
        network: 'none',
        extract: [{ from: '/app/result.json', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true, `go run failed: exit=${result.exitCode}`);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'),
      ) as { n: number; squared: number };
      assert.equal(parsed.n, 7);
      assert.equal(parsed.squared, 49);
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('runs a Ruby script that reads stdin and writes an output file', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-rb-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-rb-out-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'main.rb'),
        [
          'require "json"',
          'params = JSON.parse(STDIN.read)',
          'n = params["n"].to_i',
          'out = { "n" => n, "factorial" => (1..n).inject(1, :*) }',
          'File.write("result.json", JSON.dump(out))',
          '',
        ].join('\n'),
      );
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'ruby:3.3-alpine',
        command: 'ruby main.rb',
        dir: seedDir,
        input: { n: 6 },
        timeout: 60_000,
        network: 'none',
        extract: [{ from: '/app/result.json', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true, `ruby failed: exit=${result.exitCode}`);
      const parsed = JSON.parse(
        fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'),
      ) as { n: number; factorial: number };
      assert.equal(parsed.n, 6);
      assert.equal(parsed.factorial, 720);
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('runs a pure shell script (busybox) and extracts multiple files', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-sh-'));
    try {
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'alpine:3.19',
        command:
          'mkdir -p /app/out && ' +
          'printf "line1\\nline2\\n" > /app/out/a.txt && ' +
          'printf "x,y\\n1,2\\n3,4\\n" > /app/out/data.csv && ' +
          'wc -l /app/out/a.txt /app/out/data.csv > /app/out/stats.txt',
        timeout: 30_000,
        network: 'none',
        extract: [{ from: '/app/out', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, true);
      assert.equal(
        fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'),
        'line1\nline2\n',
      );
      assert.equal(
        fs.readFileSync(path.join(outDir, 'data.csv'), 'utf8'),
        'x,y\n1,2\n3,4\n',
      );
      assert.ok(
        fs.readFileSync(path.join(outDir, 'stats.txt'), 'utf8').length > 0,
      );
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('extract is skipped when the run fails (partial artefacts not pulled)', async () => {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-pyhalf-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'light-runner-pyhalf-out-'));
    try {
      fs.writeFileSync(
        path.join(seedDir, 'half.py'),
        [
          'open("partial.txt", "w").write("half-written")',
          'raise SystemExit(4)',
          '',
        ].join('\n'),
      );
      const runner = new DockerRunner();
      const exec = runner.run({
        image: 'python:3.12-alpine',
        command: 'python half.py',
        dir: seedDir,
        timeout: 30000,
        network: 'none',
        extract: [{ from: '/app/partial.txt', to: outDir }],
      });
      const result = await exec.result;
      assert.equal(result.success, false);
      assert.equal(result.exitCode, 4);
      // Contract: extract runs only on exitCode === 0, so nothing is pulled.
      assert.equal(result.extracted, undefined);
      assert.equal(fs.existsSync(path.join(outDir, 'partial.txt')), false);
    } finally {
      fs.rmSync(seedDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
