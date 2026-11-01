// Starts both apps for local work: web on :3000, api on :3001. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const apps = [
  ['web', ['run', 'dev', '-w', 'web']],
  ['api', ['run', 'start:dev', '-w', 'api']],
];

const children = apps.map(([name, args]) => {
  const child = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
  child.on('exit', (code) => console.log(`${name} stopped (${code})`));
  return child;
});

process.on('SIGINT', () => {
  for (const child of children) child.kill('SIGINT');
});
