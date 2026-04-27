---
title: light-runner
layout: page
sidebar: false
aside: false
pageClass: bespoke-landing-page
---

<style>
/* Hide VitePress chrome on the landing only. The bespoke design has its own
 * navbar (header.top) and footer; stacking the VitePress wrappers on top
 * doubles the visual weight at the top of the page. */
.bespoke-landing-page .VPNav,
.bespoke-landing-page .VPLocalNav,
.bespoke-landing-page .VPFooter { display: none !important; }
.bespoke-landing-page .VPContent { padding: 0 !important; }
.bespoke-landing-page main.main { margin: 0 !important; }
</style>

<div class="bespoke-landing">
<header class="top">
  <div class="shell">
    <div class="top-row">
      <a class="mark" href="#">
        <span class="mark-dot" aria-hidden="true"></span>
        <span>light-runner</span>
        <em data-gh-version></em>
      </a>
      <nav class="top-nav" aria-label="primary">
        <a href="#primitives">Primitives</a>
        <a href="#quick-start">Quick start</a>
        <a href="#security">Security</a>
        <a href="#ecosystem">Ecosystem</a>
        <a href="./api/">Documentation</a>
        <a href="https://github.com/enixCode/light-runner" class="primary">GitHub -&gt;</a>
      </nav>
    </div>
  </div>
</header>
<main>
<!-- ============ HERO ============ -->
<section class="hero">
  <div class="shell">
    <div class="hero-eyebrow">
      <span class="v" data-gh-version></span>
      <span class="divider"></span>
      <span class="tag">Execution primitive - Node.js</span>
    </div>
    <div class="hero-headline">
      <h1 class="display">
        Run untrusted code<br>
        <span class="shy">in</span> <span class="accent">hardened</span> containers.
      </h1>
      <p class="hero-lede">
        A single-purpose Node.js library that runs your code in a container
        it tears down afterwards, and hands you back <em>the exit code, logs,
        and any files you asked for.</em> Nothing else.
      </p>
      <div class="hero-meta">
        <div class="cell">
          <div class="k">Runtime</div>
          <div class="v">Node <span class="sub">&gt;=22</span></div>
        </div>
        <div class="cell">
          <div class="k">Dependencies</div>
          <div class="v">2 <span class="sub">dockerode + tar</span></div>
        </div>
        <div class="cell">
          <div class="k">Transport</div>
          <div class="v">dockerode <span class="sub">no CLI</span></div>
        </div>
        <div class="cell">
          <div class="k">Tests</div>
          <div class="v">82 / 82 <span class="sub">pass</span></div>
        </div>
        <div class="cell">
          <div class="k">License</div>
          <div class="v">MIT <span class="sub">permissive</span></div>
        </div>
      </div>
    </div>
    <figure class="hero-figure">
      <div class="hero-banner">
        <img src="/banner.webp" alt="A single glowing sphere floating above a wireframe cube on an isolated dark grid - the visual metaphor for a sandboxed container." />
        <div class="corners" aria-hidden="true"></div>
      </div>
      <figcaption class="hero-banner-caption">
        <span>Fig. 01 - One process, one cell, one grid.</span>
        <span>light-runner / visual</span>
      </figcaption>
    </figure>
  </div>
</section>
<!-- ============ PRIMITIVES ============ -->
<section id="primitives">
  <div class="shell">
    <div class="section-head">
      <div class="label">what you get</div>
      <h2>Give it code. Get back an <span class="strong">exit code</span>, logs, and the files you asked for.</h2>
    </div>
    <div class="prims">
      <div class="prim">
        <div class="num">01 / isolated</div>
        <h3>Your code runs in its own <em>cell</em>.</h3>
        <p>Every run gets a fresh container, its own volume, its own network. Nothing leaks in from the host, nothing leaks out to sibling runs. Torn down on exit - success or not.</p>
      </div>
      <div class="prim">
        <div class="num">02 / drop in, pull out</div>
        <h3>Send a folder. Get <em>any file</em> back.</h3>
        <p>Point at a directory on your disk, it becomes the container's workdir. When the run finishes, ask for any path - a report, a binary, a whole build tree - and it lands back on your host.</p>
      </div>
      <div class="prim">
        <div class="num">03 / stop on demand</div>
        <h3>Cancel, abort, or <em>time out</em>.</h3>
        <p>Pass an <code>AbortSignal</code>, call <code>cancel()</code>, or set a deadline. The container dies and its volume goes with it. No zombie processes, no leaked disk.</p>
      </div>
      <div class="prim">
        <div class="num">04 / any stack</div>
        <h3>Python, Node, Go, Ruby, shell - <em>anything</em>.</h3>
        <p>Any Docker image on your registry or someone else's. No special runtime inside the container, no SDK to import, no convention to follow. Your code stays your code.</p>
      </div>
    </div>
  </div>
</section>
<!-- ============ QUICK START ============ -->
<section id="quick-start">
  <div class="shell">
    <div class="section-head">
      <div class="label">quick start</div>
      <h2>Five lines to run, <span class="strong">one</span> to get your artefact.</h2>
    </div>
    <div class="qstart">
      <div class="side">
        <p>Point <code>light-runner</code> at an image and a folder. Pipe input through stdin. Extract whatever your container wrote.</p>
        <p>No HTTP server. No config file. No CLI.</p>
        <span class="install">npm install light-runner</span>
      </div>
      <div class="code-window">
        <div class="bar">
          <span class="pills"><i></i><i></i><i></i></span>
          <span>example.ts</span>
          <button class="copy" type="button" aria-label="Copy code" data-copy>Copy</button>
        </div>
<pre id="code-sample"><span class="k">import</span> <span class="p">{</span> <span class="f">DockerRunner</span> <span class="p">}</span> <span class="k">from</span> <span class="s">'light-runner'</span><span class="p">;</span>
<span class="k">const</span> runner <span class="p">=</span> <span class="k">new</span> <span class="f">DockerRunner</span><span class="p">(</span><span class="p">{</span> <span class="n">memory</span>: <span class="s">'512m'</span><span class="p">,</span> <span class="n">cpus</span>: <span class="s">'1'</span> <span class="p">}</span><span class="p">)</span><span class="p">;</span>
<span class="k">const</span> execution <span class="p">=</span> runner<span class="p">.</span><span class="f">run</span><span class="p">(</span><span class="p">{</span>
  <span class="n">image</span>:   <span class="s">'python:3.12-alpine'</span><span class="p">,</span>
  <span class="n">command</span>: <span class="s">'python main.py'</span><span class="p">,</span>
  <span class="n">dir</span>:     <span class="s">'./my-project'</span><span class="p">,</span>
  <span class="n">input</span>:   <span class="p">{</span> <span class="n">task</span>: <span class="s">'compute'</span><span class="p">,</span> <span class="n">n</span>: <span class="s">20</span> <span class="p">}</span><span class="p">,</span>
  <span class="n">timeout</span>: <span class="s">30_000</span><span class="p">,</span>
  <span class="n">extract</span>: <span class="p">[</span><span class="p">{</span> <span class="n">from</span>: <span class="s">'/app/result.json'</span><span class="p">,</span> <span class="n">to</span>: <span class="s">'./out'</span> <span class="p">}</span><span class="p">]</span><span class="p">,</span>
<span class="p">}</span><span class="p">)</span><span class="p">;</span>
<span class="k">const</span> result <span class="p">=</span> <span class="k">await</span> execution<span class="p">.</span>result<span class="p">;</span>
result<span class="p">.</span>success     <span class="c">// true if exit 0 and not cancelled</span>
result<span class="p">.</span>exitCode    <span class="c">// the container's exit code</span>
result<span class="p">.</span>extracted   <span class="c">// [{ from, to, status, bytes }]</span></pre>
      </div>
    </div>
  </div>
</section>
<!-- ============ SECURITY ============ -->
<section id="security">
  <div class="shell">
    <div class="section-head">
      <div class="label">security model</div>
      <h2><span class="strong">Hardened</span> defaults, never opt-out. Add more restrictions, never fewer.</h2>
    </div>
    <div class="sec-grid">
      <div class="row">
        <div class="k">Kernel permissions</div>
        <div class="v"><strong>Dangerous capabilities stripped</strong> at startup - raw sockets, device creation, chroot escapes, capability juggling, audit-log spoofing. Every run, unconditionally.</div>
      </div>
      <div class="row">
        <div class="k">No privilege escalation</div>
        <div class="v">A <strong>setuid</strong> binary inside your container cannot elevate above the user it starts as.</div>
      </div>
      <div class="row">
        <div class="k">Fork-bomb protection</div>
        <div class="v">Max <strong>100 processes</strong> per container. A runaway loop caps out in milliseconds instead of paging the host.</div>
      </div>
      <div class="row">
        <div class="k">Memory and CPU budget</div>
        <div class="v"><strong>512 MiB</strong> and <strong>one core</strong> by default, cgroup-enforced. Noisy runs cannot starve their neighbours. Tunable per runner.</div>
      </div>
      <div class="row">
        <div class="k">Network isolation</div>
        <div class="v"><strong>Isolated bridge</strong> by default with inter-container traffic blocked. Pass <code>network: 'none'</code> to sever it entirely.</div>
      </div>
      <div class="row">
        <div class="k">Host filesystem protection</div>
        <div class="v"><strong>Symlinks in your input folder are filtered</strong> before seeding, so a stray link cannot reach back into the host filesystem.</div>
      </div>
      <div class="row">
        <div class="k">Safe file extraction</div>
        <div class="v">A container cannot write outside the destination folder you chose: paths escaping upward (<code>..</code>) are refused. Each extracted entry is capped at <strong>1 GiB</strong> so a runaway output cannot fill your disk.</div>
      </div>
      <div class="row">
        <div class="k">Kernel-level hardening</div>
        <div class="v">Swap the runtime to <strong>gVisor</strong> with one option for user-space syscall interception, at ~10-30% I/O cost.</div>
      </div>
    </div>
    <div class="sec-note">
      <strong>Does not cover -</strong> kernel exploits, <code>runc</code> CVEs, side-channel attacks. For genuinely hostile code, combine with <code>{ runtime: 'runsc' }</code> (gVisor) or <code>{ runtime: 'kata' }</code> (Kata Containers, VM-level isolation - <em>option exposed but not yet validated in our test matrix</em>).
    </div>
  </div>
</section>
<!-- ============ ECOSYSTEM ============ -->
<section id="ecosystem">
  <div class="shell">
    <div class="section-head">
      <div class="label">ecosystem</div>
      <h2>Three tools. <span class="strong">Each</span> does one thing.</h2>
    </div>
    <div class="eco">
      <article class="eco-card this">
        <div class="mono-name">light-runner</div>
        <h3>Spawn one container, return exit code and files.</h3>
        <p>The execution primitive. Domain-agnostic. Zero orchestration. The other two tools in this family both call down to this one.</p>
        <div class="status" data-eco-status data-gh-repo="enixCode/light-runner" data-fallback="In development">Loading</div>
      </article>
      <article class="eco-card">
        <div class="mono-name">light-run</div>
        <h3>CLI and HTTP surface around light-runner.</h3>
        <p>Point a POST endpoint at it, pipe bodies through, get results back. Stateless wrapper, same defaults, same guarantees.</p>
        <div class="status" data-eco-status data-gh-repo="enixCode/light-run" data-fallback="In development">Loading</div>
      </article>
      <article class="eco-card">
        <div class="mono-name">light-process</div>
        <h3>DAG orchestration, retries, fan-out.</h3>
        <p>When one container is not enough. Composes runs into pipelines with backoff, concurrency limits, and structured outputs.</p>
        <div class="status" data-eco-status data-gh-repo="enixCode/light-process" data-fallback="In development">Loading</div>
      </article>
    </div>
  </div>
</section>
</main>
<footer>
  <div class="shell">
    <div class="foot-row">
      <div class="sig">
        One glowing node. One dark grid. The rest is up to the code inside.
      </div>
      <nav class="foot-links" aria-label="footer">
        <a href="./api/">API</a>
        <a href="https://github.com/enixCode/light-runner">GitHub</a>
        <a href="https://www.npmjs.com/package/light-runner">npm</a>
        <a href="#security">Security</a>
        <a href="https://github.com/enixCode/light-runner/blob/main/LICENSE">MIT</a>
      </nav>
    </div>
    <div class="foot-meta">
      <span>light-runner // execution primitive</span>
      <span>built with cc</span>
    </div>
  </div>
</footer>
</div>

<script setup>
import { onMounted } from 'vue';

// Wire DOM listeners only after hydration; SSR has no document/window.
onMounted(() => {
  const btn = document.querySelector('[data-copy]');
  const src = document.getElementById('code-sample');
  if (btn && src) {
    btn.addEventListener('click', async () => {
      const text = src.innerText.trim();
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
      } catch { btn.textContent = 'Select'; }
    });
  }
  // Single fetch per unique repo, regardless of how many DOM consumers each
  // tag has. The header em + hero eyebrow share `data-gh-version` and pull
  // from the project's own repo; each ecosystem card has its own repo. We
  // collect all unique repos first, fetch them in parallel, then dispatch
  // the resolved tags to every consumer that asked for them.
  const PROJECT_REPO = 'enixCode/light-runner';
  const repos = new Set([PROJECT_REPO]);
  document.querySelectorAll('[data-eco-status][data-gh-repo]').forEach((el) => {
    repos.add(el.getAttribute('data-gh-repo'));
  });

  const fetchLatest = (repo) =>
    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((r) => r.ok ? r.json() : null)
      .catch(() => null);

  Promise.all([...repos].map((repo) =>
    fetchLatest(repo).then((data) => [repo, data]),
  )).then((entries) => {
    const releases = new Map(entries);

    // data-gh-version (header + hero eyebrow) -> project's tag.
    const project = releases.get(PROJECT_REPO);
    if (project && project.tag_name) {
      const tag = project.tag_name;
      const v = tag.startsWith('v') ? tag : 'v' + tag;
      document.querySelectorAll('[data-gh-version]').forEach((el) => {
        el.textContent = v;
      });
    }

    // Eco cards -> their own tag, with prerelease + fallback handling.
    document.querySelectorAll('[data-eco-status][data-gh-repo]').forEach((el) => {
      const repo = el.getAttribute('data-gh-repo');
      const fallback = el.getAttribute('data-fallback') || 'In development';
      const data = releases.get(repo);
      const tag = data && data.tag_name;
      if (!tag) {
        el.textContent = fallback;
        return;
      }
      const v = tag.startsWith('v') ? tag : 'v' + tag;
      el.textContent = (data.prerelease === true ? 'Pre-release - ' : 'Stable - ') + v;
    });
  });
});
</script>
