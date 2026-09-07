import { spawn } from 'node:child_process';
import { createServer, listen } from './server.js';
import { listProjects } from './store.js';
import { PROJECTS_DIR } from './paths.js';

function parseArgs(argv: string[]): { port: number; open: boolean } {
  let port = 4173;
  let open = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[(i += 1)]);
    else if (argv[i] === '--no-open') open = false;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: claude-trees [--port <n>] [--no-open]');
      process.exit(0);
    }
  }
  return { port, open };
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(command, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    .on('error', () => undefined)
    .unref();
}

const { port, open } = parseArgs(process.argv.slice(2));
const projects = await listProjects();
if (!projects.length) {
  console.error(`No Claude Code transcripts found in ${PROJECTS_DIR}`);
  process.exit(1);
}

const server = createServer();
const actual = await listen(server, port);
const url = `http://127.0.0.1:${actual}`;
console.log(`claude-trees — ${projects.length} projects from ${PROJECTS_DIR}`);
console.log(`  ${url}`);
if (open) openBrowser(url);
