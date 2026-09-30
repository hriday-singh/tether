#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(webDir, '../..');

export function getWebPort() {
  if (process.env.WEB_PORT) {
    const val = process.env.WEB_PORT.trim();
    if (/^\d+$/.test(val)) return val;
  }

  const envFiles = [
    path.join(webDir, '.env.local'),
    path.join(webDir, '.env'),
    path.join(rootDir, '.env'),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      try {
        const content = fs.readFileSync(envFile, 'utf8');
        const match = content.match(/^WEB_PORT\s*=\s*(\d+)/m);
        if (match && match[1]) {
          return match[1];
        }
      } catch {
        // ignore read error and try next file
      }
    }
  }

  return '3001';
}

export function runNextCommand(command) {
  const port = getWebPort();

  const require = createRequire(import.meta.url);
  let nextBin;
  try {
    nextBin = require.resolve('next/dist/bin/next');
  } catch {
    nextBin = path.join(webDir, 'node_modules', 'next', 'dist', 'bin', 'next');
  }

  const userArgs = process.argv.slice(2);
  const hasCustomPort = userArgs.some((arg) => {
    return arg === '-p' || arg === '--port' || arg.startsWith('-p=') || arg.startsWith('--port=');
  });

  const portArgs = hasCustomPort ? [] : ['-p', port];
  const args = [nextBin, command, ...portArgs, ...userArgs];

  const child = spawn(process.execPath, args, {
    cwd: webDir,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}
