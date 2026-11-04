// The process of one agent run, started by ao-step.mjs (Pilot 1, T10). `claude -p` prints its result event when the
// agent is done, but it does not exit while a command the agent left in the background is alive, such as `npm run dev`
// from a check in the browser. The run was then held until that command ended, 1 to 12 minutes, and when it ended the
// agent woke up for one more turn that cost a cache write (SMP-6, SMP-7, SMP-10, SMP-11 of ao-sample). So a minute after
// the result the process is stopped, with everything it started. Every effect is a parameter, so tests run it without
// a process.

// How long after its result an agent may take to exit by itself.
export const EXIT_GRACE_MS = 60 * 1000;

// Whether a line of the stream-json output is the result event, the last of a run.
export function isResult(line) {
  try {
    return JSON.parse(line)?.type === 'result';
  } catch {
    return false;
  }
}

// Stops a process and what it started. On Windows `taskkill /T` takes the whole tree, which is where the dev servers
// are. Elsewhere only the process itself is stopped: a process group would need a detached child, and then Ctrl-C of
// the shell would not reach it.
export function killTree(pid, { platform = process.platform, spawnSync, kill }) {
  if (platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    kill(pid, 'SIGKILL');
  } catch {
    // gone already
  }
}

// Runs the agent and resolves { lines, stopped } when its process closes: the lines of its output, and whether it was
// stopped for staying alive after its result. append(stream, chunk) writes the log files.
export function startAgentProcess({ spawn, command, args, env, cwd, append, kill, graceMs = EXIT_GRACE_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  return new Promise((done) => {
    const lines = [];
    let rest = '';
    let timer = null;
    let stopped = false;
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => {
      append('stdout', chunk);
      const parts = (rest + chunk.toString('utf8')).split('\n');
      rest = parts.pop();
      lines.push(...parts);
      if (timer === null && parts.some(isResult)) {
        timer = setTimer(() => {
          stopped = true;
          kill(child.pid);
        }, graceMs);
      }
    });
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => {
      append('stderr', Buffer.from(`cannot start the agent: ${error.message}\n`));
      done({ lines, stopped });
    });
    child.on('close', () => {
      if (timer !== null) clearTimer(timer);
      done({ lines: rest ? [...lines, rest] : lines, stopped });
    });
  });
}
