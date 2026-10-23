// Serve the extracted ZIP at QA_URL, including a nested path and hash.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const out = 'artifacts/toy/qa';
await mkdir(out, { recursive: true });
const report = { errors: [], requests: [], sockets: [], checks: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1360, height: 850 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('request', req => report.requests.push(req.url()));
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
  page.on('websocket', socket => report.sockets.push(socket.url()));
  const url = process.env.QA_URL || 'http://127.0.0.1:5187/upload/game/#practice';
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ironCage);
  assert.equal(await page.locator('#btn-online').isDisabled(), true);
  await page.locator('[data-language="en"]').first().click();
  assert.match(await page.locator('#btn-online').innerText(), /unavailable/);
  await page.locator('[data-language="zh-CN"]').first().click();
  assert.match(await page.locator('#btn-online').innerText(), /不提供联机/);
  // Even scripts dispatching events to hidden controls must not connect.
  await page.evaluate(() => document.getElementById('btn-online-go').dispatchEvent(new Event('click')));
  await page.locator('#btn-start').click();
  await page.waitForFunction(() => window.__ironCage.screen === 'play');
  await page.mouse.move(700, 425);
  await page.mouse.down();
  await page.waitForFunction(() => window.__ironCage.phase === 'charge' && window.__ironCage.power > 0.3);
  await page.mouse.up();
  await page.waitForFunction(() => window.__ironCage.phase === 'rolling');
  assert.equal(await page.evaluate(() => window.__ironCage.audio.ctx.state), 'running');
  await page.screenshot({ path: `${out}/desktop-shot.png` });
  // Synthetic lifecycle event proves handler semantics; actual mobile lifecycle remains manual QA.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.__ironCage.audio.ctx.state === 'suspended');
  assert.equal(await page.evaluate(() => window.__ironCage.screen), 'pause');
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: false }));
  await page.locator('#btn-resume').click();
  await page.waitForFunction(() => window.__ironCage.audio.ctx.state === 'running');
  await page.locator('#btn-exit').click();
  await page.locator('[data-language="en"]').first().click();
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('html').getAttribute('lang'), 'en');
  report.checks.push('nested ZIP entry + hash, bilingual labels/persistence, disabled and forced online actions, real mouse shot, audio unlock, background pause/suspend and gesture resume');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', error => report.errors.push(String(error)));
  touchPage.on('request', req => report.requests.push(req.url()));
  await touchPage.goto(url, { waitUntil: 'networkidle' });
  await touchPage.locator('#btn-start').tap();
  await touchPage.waitForFunction(() => window.__ironCage.screen === 'play');
  assert.ok(await touchPage.locator('#touch-charge').isVisible());
  const charge = await touchPage.locator('#touch-charge').boundingBox();
  await touchPage.dispatchEvent('#touch-charge', 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: charge.x + 10, clientY: charge.y + 10 });
  await touchPage.waitForFunction(() => window.__ironCage.phase === 'charge' && window.__ironCage.power > 0.25);
  await touchPage.dispatchEvent('#touch-charge', 'pointerup', { pointerId: 1, pointerType: 'touch' });
  await touchPage.waitForFunction(() => window.__ironCage.phase === 'rolling');
  await touchPage.screenshot({ path: `${out}/portrait-touch-shot.png` });
  await touchPage.setViewportSize({ width: 844, height: 390 });
  await touchPage.waitForTimeout(250);
  assert.equal(await touchPage.evaluate(() => Math.round(window.__ironCage.camera.aspect * 100)), Math.round(844 / 390 * 100));
  await touchPage.screenshot({ path: `${out}/landscape-touch-shot.png` });
  report.checks.push('desktop mobile emulation only: portrait touch charge/shot and landscape renderer resize');
  assert.deepEqual(report.sockets, []);
  assert.deepEqual(report.errors, []);
  assert.ok(report.requests.every(req => new URL(req).origin === new URL(url).origin), 'No external network dependencies');
  assert.ok(report.requests.every(req => !/\/(ws|api)(\/|$)/.test(new URL(req).pathname)), 'No backend requests');
  report.checks.push('zero WebSocket/API/external requests, zero JS errors/HTTP failures');
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
