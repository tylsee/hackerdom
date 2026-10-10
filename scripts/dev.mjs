import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const children = [];
let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}
for (const name of ['backend', 'frontend']) {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: join(root, name), env: process.env, stdio: 'inherit', shell: process.platform === 'win32',
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`${name}: ${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!exiting) {
      console.error(`${name} process stopped (${code ?? 'unknown'}).`);
      shutdown(code || 1);
    }
  });
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
