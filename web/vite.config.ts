import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Every *.html in web/ is a page (index = app, spike = device check,
// harness = E2E harness, …). Agents add pages without touching this file.
const pages = Object.fromEntries(
  readdirSync(__dirname)
    .filter((f) => f.endsWith('.html'))
    .map((f) => [f.replace(/\.html$/, ''), resolve(__dirname, f)]),
);

export default defineConfig({
  server: { host: true },
  build: { target: 'es2022', rollupOptions: { input: pages } },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 60000 },
} as any);
