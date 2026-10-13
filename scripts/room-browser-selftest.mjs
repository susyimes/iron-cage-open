import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = process.env.QA_OUTPUT_DIR || "artifacts/room-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
const report = { errors: [], views: [] };
try {
  for (const [name, width, height] of [["desktop", 1600, 900], ["portrait", 390, 844], ["landscape", 844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: name !== "desktop", hasTouch: name !== "desktop" });
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(String(e)));
    page.on("console", m => { if (m.type() === "error") report.errors.push(m.text()); });
    await page.goto(process.env.QA_URL || "http://127.0.0.1:43154", { waitUntil: "networkidle" });
    await page.locator("#btn-start").click();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${out}/club-aim-${name}.png` });
    await page.locator("#btn-hud-camera").click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/club-overview-${name}.png` });
    const view = await page.evaluate(name => {
      const g = window.__ironCage;
      // Freeze normal animation while sampling real scene geometry and camera poses.
      g.renderer.setAnimationLoop(null); g.loop = () => {};
      const room = g.arena.room;
      const visible = object => { for (let p = object; p; p = p.parent) if (!p.visible) return false; return object.material.opacity > 0.15; };
      const pockets = [[-4,-2],[-4,2],[4,-2],[4,2],[0,-2],[0,2]];
      const cue = g.sim.balls.find(b => b.kind === "cue");
      const failures = [];
      let poses = 0, rays = 0, maxCalls = 0, maxTriangles = 0;
      for (const survey of [false, true]) for (const [x,z] of [[-3.05,0],[3.5,1.5],[-3.5,-1.5]]) for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        cue.pos.set(x, 0.92 + cue.radius, z);
        g.survey = survey; g.phase = "aim"; g.pitch = survey ? 1.02 : 0.72; g.dist = survey ? 9.5 : 4.8;
        g.aimDir.set(Math.cos(angle), 0, Math.sin(angle)); g.aimCam.copy(g.aimDir); g.yaw = angle; g.yawBias = 0;
        for (let settle = 0; settle < 3; settle++) g.update(1);
        g.renderer.render(g.scene, g.camera);
        maxCalls = Math.max(maxCalls, g.renderer.info.render.calls);
        maxTriangles = Math.max(maxTriangles, g.renderer.info.render.triangles);
        for (const [px,pz] of pockets) {
          const target = g.camera.position.clone().set(px, 0.935, pz);
          g.ray.set(g.camera.position, target.clone().sub(g.camera.position).normalize());
          g.ray.far = g.camera.position.distanceTo(target) - 0.025;
          const hit = g.ray.intersectObject(room.group, true).find(h => visible(h.object));
          if (hit && failures.length < 12) failures.push({ survey, cue: [x,z], angle, pocket: [px,pz], camera: g.camera.position.toArray(), object: hit.object.parent.name, opacity: hit.object.material.opacity });
          rays++;
        }
        poses++;
      }
      return { name, poses, rays, failures, maxCalls, maxTriangles, textures: g.renderer.info.memory.textures, shadowLights: (() => { let n = 0; g.scene.traverse(o => { if (o.isLight && o.castShadow) n++; }); return n; })() };
    }, name);
    report.views.push(view);
    console.log(JSON.stringify(view));
    assert.deepEqual(view.failures, [], "room decor must not cover a pocket from supported camera poses");
    assert.ok(view.maxCalls < 260, "static furnishings should stay batched");
    assert.ok(view.maxTriangles < 160000, "room geometry exceeds the mobile budget");
    assert.equal(view.shadowLights, 1, "room lighting must reuse the existing shadow pass");
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(`${out}/club-browser-report.json`, JSON.stringify(report, null, 2));
  console.log("PASS room visibility, render budget and desktop/mobile screenshots");
} finally { await browser.close(); }
