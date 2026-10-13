import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = process.env.QA_OUTPUT_DIR || "artifacts/browser-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--enable-webgl", "--ignore-gpu-blocklist"] });
const report = { errors: [] };
const base = process.env.QA_URL || "http://127.0.0.1:43153";
async function open(options = {}, latency = 0) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...options });
  await context.addInitScript((delay) => {
    const NativeSocket = window.WebSocket;
    window.__qaWire = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.gameSocket = new URL(args[0], location.href).pathname === "/ws";
        if (this.gameSocket) window.__qaSocket = this;
      }
      send(data) {
        if (!this.gameSocket) return super.send(data);
        const m = JSON.parse(data);
        if (m.t === "shot") {
          const cue = window.__ironCage.sim.balls.find(b => b.kind === "cue");
          window.__qaShot = { sentAt: performance.now(), from: cue.pos.toArray(), requestId: m.requestId };
        }
        if (delay) setTimeout(() => { if (this.readyState === NativeSocket.OPEN) super.send(data); }, delay);
        else super.send(data);
      }
      addEventListener(type, listener, opts) {
        if (type !== "message" || !this.gameSocket) return super.addEventListener(type, listener, opts);
        return super.addEventListener(type, event => {
          const deliver = () => {
            const m = JSON.parse(event.data);
            window.__qaLastMessage = m;
            window.__qaWire.push({ type: m.t, bytes: event.data.length, at: performance.now(), shotId: m.shot?.id ?? m.shotId });
            if (m.t === "shot-start" && window.__qaShot?.requestId === m.shot.requestId) window.__qaShot.ackAt = performance.now();
            if (typeof listener === "function") listener.call(this, event); else listener.handleEvent(event);
          };
          if (delay) setTimeout(deliver, delay); else deliver();
        }, opts);
      }
    };
  }, latency);
  const page = await context.newPage();
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error" && !m.text().includes("favicon")) report.errors.push(m.text()); });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__ironCage);
  return page;
}
const snapshot = page => page.evaluate(() => window.__ironCage.sim.balls.map(b => ({ id: b.id, p: b.pos.toArray(), radius: b.radius, pocketed: b.pocketed, shattered: b.shattered })));
const done = (page, shots = 1) => page.waitForFunction(count => {
  const g = window.__ironCage, s = g.onlineState;
  return !g.isPlayingShot && s?.phase !== "rolling" && s.shots[0] + s.shots[1] >= count;
}, shots, { timeout: 35000 });
async function shoot(page, power = 0.11, ax = -1) {
  await page.waitForFunction(() => window.__ironCage.onlineState?.phase === "aim");
  if (await page.evaluate(() => window.__ironCage.placing)) await placeByPointer(page);
  await page.waitForFunction(() => window.__ironCage.myTurn && window.__ironCage.phase === "aim", {}, { timeout: 35000 });
  await page.evaluate(({ power, ax }) => { const g = window.__ironCage; g.aimDir.set(ax, 0, 0.03); g.aimDir.normalize(); g.aimLoft = 0; g.power = power; g.releaseShot(g.sim.balls.find(b => b.kind === "cue")); }, { power, ax });
  await page.waitForFunction(() => window.__ironCage.isPlayingShot);
}

async function placeByPointer(page) {
  await page.waitForFunction(() => window.__ironCage.placing && window.__ironCage.myTurn && window.__ironCage.screen === "play");
  await page.waitForTimeout(900);
  const spot = await page.evaluate(() => {
    const g = window.__ironCage;
    const cue = g.sim.balls.find(b => b.kind === "cue");
    const candidates = [{ x: cue.pos.x, z: cue.pos.z }];
    for (let x = -2.8; x <= 2.8; x += 0.4) for (let z = -1.4; z <= 1.4; z += 0.4) candidates.push({ x, z });
    const p = candidates.find(p => Math.abs(p.x) < 3.7 && Math.abs(p.z) < 1.7 && g.sim.balls.every(b => b.kind === "cue" || b.pocketed || Math.hypot(b.pos.x - p.x, b.pos.z - p.z) > 0.27));
    if (!p) throw new Error("No free test placement");
    const screen = cue.pos.clone().set(p.x, 0.92, p.z).project(g.camera);
    const box = g.renderer.domElement.getBoundingClientRect();
    return { x: box.left + (screen.x + 1) * box.width / 2, y: box.top + (1 - screen.y) * box.height / 2 };
  });
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) await page.touchscreen.tap(spot.x, spot.y);
  else await page.mouse.click(spot.x, spot.y);
  await page.waitForFunction(() => !window.__ironCage.placing, {}, { timeout: 5000 });
  assert.ok(await page.evaluate(() => window.__ironCage.hud().canShoot));
}

async function trackHandover(page) {
  await page.evaluate(() => {
    const g = window.__ironCage;
    window.__qaHandover = [];
    const sync = g.syncOnlineBalls.bind(g);
    g.syncOnlineBalls = function (balls) {
      if (this.phase === "rolling" && this.motionDone) {
        const errors = balls.filter(b => b.kind === "enemy" && !b.pocketed).map(b => {
          const local = this.sim.balls.find(a => a.id === b.id);
          return local ? Math.hypot(local.pos.x - b.x, local.pos.z - b.z) : Infinity;
        });
        window.__qaHandover.push({ step: this.shotStep, maxObjectCorrection: Math.max(0, ...errors) });
      }
      sync(balls);
    };
  });
}

try {
  const solo = await open();
  await solo.locator("#btn-start").click();
  report.cue = await solo.evaluate(() => ({ logs: window.__ironCage.selfTest(), scale: window.__ironCage.stick.scale.toArray() }));
  assert.ok(!report.cue.logs.some(l => l.startsWith("FAIL")));
  assert.deepEqual(report.cue.scale, [1, 1, 1]);
  await solo.evaluate(() => window.__ironCage.startRun());
  const initialCue = await solo.evaluate(() => window.__ironCage.sim.balls.find(b => b.kind === "cue").pos.toArray());
  const aimLoft = () => solo.evaluate(() => window.__ironCage.aimLoft);
  for (const [up, down] of [["KeyW", "KeyS"], ["ArrowUp", "ArrowDown"]]) {
    await solo.keyboard.down(up); await solo.waitForTimeout(400); await solo.keyboard.up(up);
    assert.ok(await aimLoft() > 0.04, `${up} must raise the cue`);
    await solo.keyboard.down(down); await solo.waitForTimeout(550); await solo.keyboard.up(down);
    assert.equal(await aimLoft(), 0, `${down} must lower the cue to a level shot`);
  }
  await solo.mouse.move(720, 500);
  const beforeMouse = await aimLoft();
  await solo.mouse.move(720, 350, { steps: 8 });
  await solo.waitForTimeout(80);
  assert.ok(await aimLoft() > beforeMouse + 0.025, "upward mouse movement must raise the cue");
  await solo.mouse.move(720, 500, { steps: 8 });
  await solo.waitForTimeout(80);
  assert.ok(await aimLoft() < beforeMouse + 0.005, "downward mouse movement must lower the cue");
  await solo.keyboard.down("Space"); await solo.waitForTimeout(200);
  assert.equal(await solo.evaluate(() => window.__ironCage.phase), "charge");
  await solo.evaluate(() => window.dispatchEvent(new Event("blur")));
  await solo.waitForTimeout(60); await solo.keyboard.up("Space");
  assert.equal(await solo.evaluate(() => window.__ironCage.phase), "aim");
  await solo.evaluate(() => {
    const g = window.__ironCage; g.startRun(); g.soloRules.breakShot = false;
    for (const b of g.sim.balls) {
      if (b.kind === "enemy" && ![1, 8, 9].includes(b.number)) { b.pocketed = b.scored = true; if (b.mesh) b.mesh.visible = false; }
      if (b.number === 1) b.pos.set(0, 1.04, 1.45);
      if (b.number === 8) b.pos.set(-2, 1.04, -1);
      if (b.number === 9) b.pos.set(2, 1.04, -1);
      if (b.kind === "cue") b.pos.set(0, 1.04, 0.6);
    }
    g.beginMotion({ ax: 0, az: 1, power: 0.18, loft: 0 });
  });
  await solo.waitForFunction(() => !window.__ironCage.isPlayingShot && window.__ironCage.score === 100);
  assert.equal(await solo.evaluate(() => window.__ironCage.soloRules.groups[0]), "solids");
  await solo.screenshot({ path: out + "/eight-ball-practice.png" });
  await solo.evaluate(() => window.__ironCage.beginMotion({ ax: -1, az: 0, power: 0.13, loft: 0 }));
  await solo.waitForFunction(() => !window.__ironCage.isPlayingShot && window.__ironCage.soloRules.last?.foul);
  const foul = await solo.evaluate(() => {
    const g = window.__ironCage;
    return { position: g.sim.balls.find(b => b.kind === "cue").pos.toArray(), placing: g.placing, hand: g.soloRules.ballInHand, canShoot: g.hud().canShoot, summary: g.soloRules.last.summary };
  });
  assert.deepEqual(foul.position, initialCue, "ordinary solo fouls must reset to the starting spot");
  assert.equal(foul.placing, false); assert.equal(foul.hand, null); assert.ok(foul.canShoot);
  assert.ok(!foul.summary.includes("自由球"));
  const objectsBeforeScratch = await solo.evaluate((initial) => {
    const g = window.__ironCage;
    g.sim.balls.find(b => b.number === 9).pos.fromArray(initial);
    g.sim.balls.find(b => b.kind === "cue").pos.set(0, 1.04, 1.2);
    const objects = g.sim.balls.filter(b => b.kind === "enemy").map(b => b.pos.toArray());
    g.beginMotion({ ax: 0, az: 1, power: 0.18, loft: 0 });
    return objects;
  }, initialCue);
  await solo.waitForFunction(() => !window.__ironCage.isPlayingShot && window.__ironCage.soloRules.last?.foul === "白球落袋");
  const scratch = await solo.evaluate(() => {
    const g = window.__ironCage, cue = g.sim.balls.find(b => b.kind === "cue");
    return { position: cue.pos.toArray(), placing: g.placing, canShoot: g.hud().canShoot, score: g.score, group: g.soloRules.groups[0],
      clear: g.sim.live().every(b => b === cue || cue.pos.distanceTo(b.pos) >= cue.radius + b.radius + 0.01),
      objects: g.sim.balls.filter(b => b.kind === "enemy").map(b => b.pos.toArray()) };
  });
  assert.ok(!scratch.placing && scratch.canShoot && scratch.clear);
  assert.ok(Math.hypot(...scratch.position.map((n, i) => n - initialCue[i])) < 0.5, "blocked starting spot must use a nearby clear position");
  assert.deepEqual(scratch.objects, objectsBeforeScratch, "solo respot must preserve object ball positions");
  assert.equal(scratch.score, 100); assert.equal(scratch.group, "solids");
  report.soloFouls = { ordinary: foul, scratch };
  await solo.evaluate(() => {
    const g = window.__ironCage;
    g.sim.balls.find(b => b.kind === "cue").pos.set(0, 1.04, 0.6);
    g.sim.balls.find(b => b.number === 8).pos.set(0, 1.04, 1.45);
    g.beginMotion({ ax: 0, az: 1, power: 0.18, loft: 0 });
  });
  await solo.waitForFunction(() => window.__ironCage.screen === "over");
  assert.equal(await solo.evaluate(() => window.__ironCage.soloRules.winner), 0);
  console.log("PASS browser practice: keyboard/mouse loft, automatic foul/scratch respot, blocked starting spot, own group, legal black and charge cancellation");
  await solo.context().close();

  const touch = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.locator("#btn-start").tap();
  const touchSession = await touch.context().newCDPSession(touch);
  for (const [selector, raises] of [["#touch-loft-up", true], ["#touch-loft-down", false]]) {
    const button = touch.locator(selector);
    assert.ok(await button.isVisible());
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390 && box.y + box.height <= 844);
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await touch.waitForFunction(up => up ? window.__ironCage.aimLoft > 0.08 : window.__ironCage.aimLoft === 0, raises, { timeout: 10000 });
    await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const loft = await touch.evaluate(() => window.__ironCage.aimLoft);
    assert.ok(raises ? loft > 0.06 : loft === 0, `${selector} must change shot loft`);
  }
  await touch.screenshot({ path: out + "/eight-ball-controls-portrait.png" });
  await touch.setViewportSize({ width: 844, height: 390 });
  await touch.waitForTimeout(500);
  for (const button of await touch.locator("#touch-pad button").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 390, "all five touch controls must fit landscape");
  }
  await touch.screenshot({ path: out + "/eight-ball-controls-landscape.png" });
  await touchSession.detach();
  await touch.context().close();
  console.log("PASS touch loft buttons and portrait/landscape control layout");

  const a = await open({}, 150);
  const b = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 150);
  await a.locator("#btn-online").click();
  await a.locator("#online-name").fill("甲方");
  await a.locator("#btn-online-go").click();
  await a.waitForFunction(() => window.__ironCage.onlineState?.room);
  const room = await a.evaluate(() => window.__ironCage.onlineState.room);
  await b.locator("#btn-online").tap();
  await b.locator("#online-name").fill("手机乙方");
  await b.locator("#online-room").fill(room);
  await b.locator("#btn-online-go").tap();
  await a.waitForFunction(() => window.__ironCage.myTurn);
  await b.waitForFunction(() => window.__ironCage.onlineState?.phase === "aim");
  for (const p of [a, b]) {
    assert.ok(await p.evaluate(() => window.__ironCage.sim.pocketsLive), "title scene must not leave online pockets disabled");
    const order = await p.evaluate(() => ({ sim: window.__ironCage.sim.balls.map(b => b.id), server: window.__ironCage.onlineState.balls.map(b => b.id) }));
    assert.deepEqual(order.sim, order.server, "physics order must match authoritative snapshot order");
    await trackHandover(p);
  }
  report.mobile = await b.evaluate(() => {
    const text = document.querySelector("#hud-status");
    return {
      activeTag: document.activeElement.tagName,
      inputsDisabled: [...document.querySelectorAll("#online-box input")].every(x => x.disabled),
      userSelect: getComputedStyle(text).userSelect,
      copyPrevented: !text.dispatchEvent(new Event("copy", { bubbles: true, cancelable: true })),
    };
  });
  assert.notEqual(report.mobile.activeTag, "INPUT"); assert.ok(report.mobile.inputsDisabled && report.mobile.copyPrevented);
  assert.equal(report.mobile.userSelect, "none");
  await shoot(a, 0.5, 1);
  report.prediction = await a.evaluate(async () => {
    const cue = window.__ironCage.sim.balls.find(b => b.kind === "cue");
    const trace = window.__qaShot;
    let distance = 0;
    do {
      await new Promise(requestAnimationFrame);
      distance = Math.hypot(...cue.pos.toArray().map((n, i) => n - trace.from[i]));
    } while (distance < 1e-6 && performance.now() - trace.sentAt < 150);
    return { responseMs: performance.now() - trace.sentAt, distance, acknowledged: !!trace.ackAt };
  });
  assert.ok(report.prediction.distance > 0 && report.prediction.responseMs < 150 && !report.prediction.acknowledged);
  await Promise.all([done(a), done(b)]);
  assert.deepEqual(await snapshot(a), await snapshot(b));
  report.firstShot = await a.evaluate(() => ({ pockets: window.__ironCage.onlineState.balls.filter(b => b.kind === "enemy" && b.pocketed).map(b => b.number), handover: window.__qaHandover.at(-1) }));
  assert.ok(report.firstShot.pockets.length, "the real online break must exercise pocket simulation");
  console.log("PASS 300 ms RTT local prediction", report.prediction);
  // Stop requestAnimationFrame rendering on the phone. Its fallback runs about
  // 10–12 fps; simulation must retain wall time instead of discarding >50 ms frames.
  await b.evaluate(() => window.__ironCage.renderer.setAnimationLoop(null));
  report.shots = [];
  for (let i = 1; i < 8; i++) {
    const state = await a.evaluate(() => window.__ironCage.onlineState);
    const p = state.turn === 0 ? a : b;
    const started = Date.now();
    await shoot(p);
    if (i === 1) { await p.waitForTimeout(400); await p.evaluate(() => window.__qaSocket.send(JSON.stringify({ t: "sync" }))); }
    await Promise.all([done(a, i + 1), done(b, i + 1)]);
    assert.deepEqual(await snapshot(a), await snapshot(b), `shot ${i + 1} settlement`);
    report.shots.push({ shot: i + 1, elapsedMsIncludingPlacement: Date.now() - started, turn: await a.evaluate(() => window.__ironCage.onlineState.turn) });
    if (i === 5) {
      for (const peer of [a, b]) {
        await peer.waitForFunction(() => window.__ironCage.screen === "upgrade");
        const preferred = peer.locator(peer === a ? ".card.curse" : ".card:not(.curse)");
        assert.ok(await preferred.count(), "the deterministic deal must cover an asymmetric curse");
        await preferred.first().click();
      }
      await a.waitForFunction(() => window.__ironCage.onlineState.phase === "aim");
      await b.waitForFunction(() => window.__ironCage.onlineState.phase === "aim");
      report.cards = await a.evaluate(() => ({ mods: window.__ironCage.onlineState.mods, receivedCurses: window.__ironCage.onlineState.curses }));
      assert.ok(Object.values(report.cards.receivedCurses[0]).every(n => n === 0), "player zero must not receive their own curse");
      assert.ok(Object.values(report.cards.receivedCurses[1]).some(n => n > 0));
    }
    for (const peer of [a, b]) {
      const effects = await peer.evaluate(() => {
        const g = window.__ironCage, s = g.onlineState;
        return { owner: s.turn, actual: g.sim.mods, expected: s.mods[s.turn], actualGrip: g.sim.feltGrip, curses: s.curses[s.turn], chips: document.querySelector("#hud-mods").textContent };
      });
      assert.deepEqual(effects.actual, effects.expected, "active shot must use the turn owner's modifiers");
      const grip = [1, 1.9, 3.4, 6, 10][effects.curses.grip] * [1, 0.58, 0.34, 0.18, 0.08][effects.expected.slick];
      assert.equal(effects.actualGrip, grip);
    }
    console.log("PASS browser shot", i + 1, "including low-frame-rate phone and current-player effects");
  }
  await b.evaluate(() => window.__ironCage.renderer.setAnimationLoop(window.__ironCage.loop));
  report.handover = [...await a.evaluate(() => window.__qaHandover), ...await b.evaluate(() => window.__qaHandover)];
  assert.ok(report.handover.length >= 12);
  assert.ok(report.handover.every(h => h.maxObjectCorrection < 1e-7), JSON.stringify(report.handover));
  await a.screenshot({ path: out + "/eight-ball-online-desktop.png" });
  await b.screenshot({ path: out + "/eight-ball-online-mobile.png" });
  const placing = await a.evaluate(() => window.__ironCage.onlineState.turn) === 0 ? a : b;
  if (await placing.evaluate(() => window.__ironCage.placing)) await placeByPointer(placing);
  await b.setViewportSize({ width: 844, height: 390 });
  await b.waitForTimeout(700);
  await b.screenshot({ path: out + "/eight-ball-online-landscape.png" });
  await b.evaluate(() => window.__qaSocket.close());
  await a.waitForFunction(() => window.__ironCage.screen === "over");
  assert.equal(await a.evaluate(() => window.__ironCage.onlineState.winner), 0);
  assert.deepEqual(report.errors, []);
  await writeFile(out + "/eight-ball-browser-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  report.states = [];
  for (const context of browser.contexts()) for (const page of context.pages()) {
    report.states.push(await page.evaluate(() => {
      const g = window.__ironCage;
      return g ? { screen: g.screen, status: g.status, phase: g.phase, myTurn: g.myTurn, placing: g.placing, motion: g.isPlayingShot, shotStep: g.shotStep, state: g.onlineState, wire: window.__qaWire?.slice(-8) } : null;
    }).catch(() => null));
  }
  await writeFile(out + "/eight-ball-browser-failure.json", JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report.states.map(s => s && ({ screen: s.screen, status: s.status, phase: s.phase, myTurn: s.myTurn, placing: s.placing, shots: s.state?.shots, turn: s.state?.turn })), null, 2));
  throw error;
} finally { await browser.close(); }
