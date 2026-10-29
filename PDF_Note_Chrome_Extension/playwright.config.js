import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 120000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1400, height: 1100 }, acceptDownloads: true },
  webServer: { command: 'node tests/server.mjs', url: 'http://127.0.0.1:4173/editor.html', reuseExistingServer: true },
});
