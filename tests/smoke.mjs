// End-to-end smoke test: serves the game, plays it in headless Chromium
// (desktop + emulated iPhone), checks for errors and takes screenshots.
// Usage: node tests/smoke.mjs   (requires the `playwright` package)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'tests', 'screenshots');
await mkdir(shots, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(root, p === '/' ? 'index.html' : p);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failures++; };
const wait = (page, fn, timeout = 60000) => page.waitForFunction(fn, null, { timeout, polling: 200 });

async function run(name, contextOpts, touch) {
  console.log(`\n[${name}]`);
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts\.g/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  await page.goto(url);
  await wait(page, () => window.blockworld && window.blockworld.world && window.blockworld.world.chunks.size > 4);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, `${name}-1-title.png`) });
  check(await page.isVisible('#menu-title'), 'title menu visible');

  // Settings opens and closes
  await page.click('#menu-title [data-action="settings"]');
  check(await page.isVisible('#menu-settings'), 'settings menu opens');
  await page.screenshot({ path: join(shots, `${name}-2-settings.png`) });
  await page.click('#menu-settings [data-action="back"]');

  // Create a world
  await page.click('#menu-title [data-action="create"]');
  await page.fill('#create-form input[name="name"]', `Test ${name}`);
  await page.fill('#create-form input[name="seed"]', 'hello');
  await page.click('#create-form button[type="submit"]');
  await wait(page, () => window.blockworld.state === 'playing', 90000);
  check(true, 'world generated and playing');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, `${name}-3-playing.png`) });

  const g = await page.evaluate(() => {
    const b = window.blockworld;
    return { y: b.player.pos.y, chunks: b.world.chunks.size, ground: b.player.onGround };
  });
  check(g.chunks > 9, `chunks loaded (${g.chunks})`);
  check(g.ground, 'player standing on ground');

  // Look down a bit and break a block via the game API used by input
  const broke = await page.evaluate(() => {
    const b = window.blockworld;
    b.player.pitch = -1.2;
    b.player.applyToCamera(b.camera);
    const dir = b.player.lookDir();
    const hit = b.world.raycast(b.player.eye, dir, 6);
    if (!hit) return { ok: false };
    b.breakBlock(hit);
    const after = b.world.getBlock(hit.x, hit.y, hit.z);
    return { ok: after !== hit.id, id: hit.id, after };
  });
  check(broke.ok, `block broken (${broke.id} -> ${broke.after})`);

  if (touch) {
    // Real touch input: drag joystick forward & press jump
    const vp = page.viewportSize();
    const before = await page.evaluate(() => ({ x: window.blockworld.player.pos.x, z: window.blockworld.player.pos.z }));
    const cdp = await ctx.newCDPSession(page);
    const sx = 110, sy = vp.height - 120;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 10, id: 1 }] });
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(shots, `${name}-4-joystick.png`) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await page.evaluate(() => ({ x: window.blockworld.player.pos.x, z: window.blockworld.player.pos.z }));
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    check(moved > 0.5, `joystick moved player (${moved.toFixed(2)} blocks)`);

    // Look drag on right side
    const yaw0 = await page.evaluate(() => window.blockworld.player.yaw);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: vp.width * 0.6, y: vp.height * 0.4, id: 2 }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: vp.width * 0.6 + i * 15, y: vp.height * 0.4, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    const yaw1 = await page.evaluate(() => window.blockworld.player.yaw);
    check(Math.abs(yaw1 - yaw0) > 0.1, 'touch drag rotates camera');

    // Clear an open 7x7 pad around the player so the button tests don't depend on terrain
    await page.evaluate(() => {
      const b = window.blockworld, p = b.player;
      const fx = Math.floor(p.pos.x), fy = Math.floor(p.pos.y), fz = Math.floor(p.pos.z);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        b.world.setBlock(fx + dx, fy - 1, fz + dz, 3);
        for (let y = fy; y < fy + 5; y++) b.world.setBlock(fx + dx, y, fz + dz, 0);
      }
      p.pos.set(fx + 0.5, fy + 0.001, fz + 0.5); p.vel.set(0, 0, 0);
    });
    await page.waitForTimeout(500);
    // Tap place button
    const box = await page.locator('#btn-place').boundingBox();
    const countEdits = () => page.evaluate(() => [...window.blockworld.world.edits.values()].reduce((a, m) => a + [...m.values()].filter((id) => id !== 0).length, 0));
    const countBefore = await countEdits();
    await page.evaluate(() => { window.blockworld.player.pitch = -0.6; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 3 }] });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
    const countAfter = await countEdits();
    check(countAfter > countBefore, 'place button placed a block');

    // Jump button
    const jb = await page.locator('#btn-jump').boundingBox();
    await page.evaluate(() => { // stand on top of the column so nothing is overhead
      const b = window.blockworld, p = b.player;
      p.pos.y = b.world.topSolid(Math.floor(p.pos.x), Math.floor(p.pos.z)) + 1.001; p.vel.set(0, 0, 0);
    });
    await page.waitForTimeout(500);
    const y0 = await page.evaluate(() => window.blockworld.player.pos.y);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: jb.x + jb.width / 2, y: jb.y + jb.height / 2, id: 4 }] });
    const y1 = await page.evaluate(async () => {
      let m = -1e9, v = 0;
      for (let i = 0; i < 40; i++) { m = Math.max(m, window.blockworld.player.pos.y); v = Math.max(v, window.blockworld.player.vel.y); await new Promise((r) => setTimeout(r, 25)); }
      return { m, v };
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    check(y1.v > 6 && y1.m > y0 + 0.15, `jump button jumps (vy ${y1.v.toFixed(1)}, rise ${(y1.m - y0).toFixed(2)})`);
  } else {
    // keyboard walk
    const before = await page.evaluate(() => ({ ...window.blockworld.player.pos }));
    await page.evaluate(() => { window.blockworld.controls.keys.add('KeyW'); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.blockworld.controls.keys.delete('KeyW'); });
    const after = await page.evaluate(() => ({ ...window.blockworld.player.pos }));
    check(Math.hypot(after.x - before.x, after.z - before.z) > 0.5, 'keyboard W moves player');
    // fly toggle
    await page.evaluate(() => { window.blockworld.controls.flyToggleQueued = true; });
    await page.waitForTimeout(500);
    check(await page.evaluate(() => window.blockworld.player.flying), 'creative flying toggles');
    // night time screenshot
    await page.evaluate(() => { window.blockworld.time = 0.52; window.blockworld.player.pitch = 0.15; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(shots, `${name}-5-sunset.png`) });
    await page.evaluate(() => { window.blockworld.time = 0.8; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(shots, `${name}-6-night.png`) });
    await page.evaluate(() => { window.blockworld.time = 0.2; });
  }

  // Save, quit, reload page, and continue the world
  await page.evaluate(() => window.blockworld.pause());
  await page.screenshot({ path: join(shots, `${name}-7-pause.png`) });
  await page.click('#menu-pause [data-action="quit"]');
  check(await page.isVisible('#menu-title'), 'quit back to title');
  const editsSaved = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('blockworld.worlds'));
    const w = JSON.parse(localStorage.getItem('blockworld.world.' + list[0].id));
    return Object.keys(w.edits).length;
  });
  check(editsSaved > 0, `edits saved to localStorage (${editsSaved} chunks)`);

  await page.reload();
  await wait(page, () => window.blockworld && window.blockworld.state === 'title');
  await page.click('#menu-title [data-action="play"]');
  check(await page.isVisible('#menu-worlds'), 'world list shown');
  await page.screenshot({ path: join(shots, `${name}-8-worlds.png`) });
  await page.click('#world-list .btn.primary');
  await wait(page, () => window.blockworld.state === 'playing', 90000);
  const restored = await page.evaluate(() => {
    const b = window.blockworld;
    return [...b.world.edits.values()].reduce((a, m) => a + m.size, 0);
  });
  check(restored > 0, `world loaded with edits restored (${restored})`);

  // performance sample
  await page.waitForTimeout(2000);
  const fps = await page.evaluate(() => window.blockworld.fps);
  console.log(`  i fps in headless software GL: ${fps}`);

  check(errors.length === 0, 'no JS errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 720 } }, false);
  await run('iphone', { ...devices['iPhone 13 landscape'] }, true);
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
