import { spawn } from 'node:child_process';
import process from 'node:process';

/**
 * Spawn a child process and capture its stdout/stderr, resolving to a
 * normalized result object. Shared by the predeploy and consumer-build
 * gates so their command-runner logic stays in sync.
 */
export function spawnCapture(command, { cwd = process.cwd() } = {}) {
  return new Promise((resolve) => {
    const [bin, ...args] = command;
    const child = spawn(process.platform === 'win32' && bin === 'pnpm' ? 'pnpm.cmd' : bin, args, {
      cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const stdout = [];
    const stderr = [];
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.once('error', (error) => {
      finish({
        exit_code: null,
        signal: 'spawn_error',
        stdout: stdout.join('').trim(),
        stderr: [stderr.join('').trim(), error.message].filter(Boolean).join('\n'),
      });
    });
    child.once('exit', (code, signal) => {
      finish({
        exit_code: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        stdout: stdout.join('').trim(),
        stderr: stderr.join('').trim(),
      });
    });
  });
}
