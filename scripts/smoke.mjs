// Smoke check: loads the built site (dist/) in a headless browser on a phone and a desktop
// screen, opens a rig and its weather, and fails if the page throws or goes blank.
// Catches whole-site crashes (like a hook added below an early return) before they go live.
//
// Usage: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE = `http://127.0.0.1:${PORT}`;
const SETTLE_MS = Number(process.env.SMOKE_SETTLE_MS || 12000);

if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { stdio: 'ignore' }
);
const stop = () => server.kill();

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
}

const launchOptions = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

async function check(browser, label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 1. Home page renders the rig picker
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('select[aria-label="Choose rig or airport"]').first().waitFor({ state: 'attached', timeout: 20000 });

  // 2. A shared rig link opens that rig; let its forecast load
  await page.goto(BASE + '/?rig=apache-forties-alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(SETTLE_MS);

  // 3. Open the weather panel (where most crashes have been) and let it render
  const weatherButton = page.getByRole('button', { name: /weather/i }).first();
  if (await weatherButton.count()) {
    await weatherButton.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS / 2);
  }

  const rootChildren = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
  await context.close();

  const problems = [...errors];
  if (rootChildren === 0) problems.push('page went blank (#root is empty)');
  if (problems.length) {
    console.error(`✗ ${label}:\n  - ${problems.join('\n  - ')}`);
    return false;
  }
  console.log(`✓ ${label}: loaded, opened a rig and its weather with no errors`);
  return true;
}

let ok = false;
try {
  await waitForServer();
  const browser = await chromium.launch(launchOptions);
  const phone = await check(browser, 'phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const desktop = await check(browser, 'desktop', { viewport: { width: 1366, height: 900 } });
  await browser.close();
  ok = phone && desktop;
} catch (err) {
  console.error('Smoke check could not run:', err);
} finally {
  stop();
}
process.exit(ok ? 0 : 1);
