import assert from "node:assert/strict";
import { BALL, TABLE, kitchenX } from "../../client/src/game/config.ts";
import { makeBall, Sim, type Impact } from "../../client/src/game/physics.ts";
import { collectScore, normalizeShot, respotCue, restoreBall, snapshotBalls, startShot, STEP, stepShot, stopShot, MAX_SHOT_STEPS } from "../../client/src/game/shot.ts";
import { applyCard, availableCards, CARD_CAP, cueLightMul, cueShrinkMul, emptyCurses, emptyMods, enemyRadiusMul, feltScale, type Curses, type Mods } from "../../client/src/game/upgrades.ts";
import { Match } from "./match.ts";
import type { ClientMsg, ServerMsg } from "./protocol.ts";

function fail(message: string): never { throw new Error(message); }
function fixture() {
  const inbox: ServerMsg[][] = [[], []];
  const match = new Match("TEST", 7);
  assert.equal(match.join("甲", (m) => inbox[0].push(m)), 0);
  assert.equal(match.join("乙", (m) => inbox[1].push(m)), 1);
  return { match, inbox };
}
function request(match: Match, changes: Partial<Extract<ClientMsg, { t: "shot" }>> = {}): Extract<ClientMsg, { t: "shot" }> {
  return { t: "shot", requestId: (match.seats[match.turn]?.lastRequest ?? 0) + 1, revision: match.revision, ax: -1, az: 0.07, power: 0.13, loft: 0.025, ...changes };
}
function finish(match: Match) {
  let ticks = 0;
  while (match.activeShot && ticks++ < MAX_SHOT_STEPS + 5) match.advance(STEP);
  assert.equal(match.activeShot, null, "shot must settle in bounded time");
}
function placeIfNeeded(match: Match) { if (match.rules.ballInHand !== null) { const cue = match.sim.balls.find(b => b.kind === "cue")!; assert.ok(match.place(match.turn, cue.pos.x, cue.pos.z, match.revision)); } }
function play(match: Match) { placeIfNeeded(match); assert.ok(match.shot(match.turn, request(match))); finish(match); }
function clone(sim: Sim) {
  const copy = new Sim(); copy.walls = sim.walls; copy.mods = { ...sim.mods }; copy.feltGrip = sim.feltGrip;
  copy.balls = snapshotBalls(sim).map((s) => {
    const b = makeBall(s.kind, s.number, s.radius, s.mass, s.maxHp, null, s.x, s.y, s.z);
    restoreBall(b, s); return b;
  });
  return copy;
}

{
  const { match: flat } = fixture();
  const { match: raised } = fixture();
  assert.ok(flat.shot(0, request(flat, { ax: 1, az: 0, power: 0.5, loft: 0 })));
  assert.ok(raised.shot(0, request(raised, { ax: 1, az: 0, power: 0.5, loft: 0.4 })));
  for (let i = 0; i < 6; i++) { flat.advance(STEP); raised.advance(STEP); }
  const flatCue = flat.sim.balls.find(b => b.kind === "cue")!;
  const raisedCue = raised.sim.balls.find(b => b.kind === "cue")!;
  assert.ok(Math.abs(flatCue.pos.y - TABLE.feltY - flatCue.radius) < 1e-6, "level shots stay on the cloth");
  assert.ok(raisedCue.pos.y > flatCue.pos.y + 0.15, "raising the cue must change the actual eight-ball trajectory");
  finish(flat); finish(raised);
  console.log("PASS level and raised shots retain their selected vertical trajectory");
}

{
  const { match: m, inbox } = fixture();
  const original = snapshotBalls(m.sim);
  for (const changes of [{ ax: NaN }, { az: Infinity }, { power: NaN }, { loft: -Infinity }, { ax: 0, az: 0 }, { power: 0.01 }, { revision: -1 }, { requestId: 0 }]) {
    assert.equal(m.shot(0, request(m, changes)), false);
    assert.deepEqual(snapshotBalls(m.sim), original);
  }
  assert.equal(m.shot(1, request(m)), false, "wrong player rejected");
  const shot = request(m);
  assert.ok(m.shot(0, shot));
  assert.equal(m.phase, "rolling");
  assert.equal(m.activeShot?.step, 0, "acceptance precedes simulation");
  assert.equal(inbox[0].at(-1)?.t, "shot-start");
  assert.ok(JSON.stringify(inbox[0].at(-1)).length < 12000, "small start snapshot, no complete frame history");
  assert.equal(m.shot(0, shot), false, "duplicate request rejected");
  assert.equal(m.shot(1, request(m)), false, "cannot fire during another shot");
  finish(m);
  assert.equal(m.turn, 1);
  const resting = m.sim.balls.find((b) => b.kind === "cue")!.pos.clone();
  assert.ok(Math.abs(resting.x - kitchenX()) > 0.01, "cue remains at its actual resting position");
  assert.equal(m.rules.ballInHand, 1);
  assert.equal(m.shot(1, request(m)), false, "free ball requires placement before shooting");
  placeIfNeeded(m);
  assert.ok(m.shot(1, request(m)));
  const next = inbox[1].at(-1);
  assert.ok(next?.t === "shot-start");
  assert.equal(next.state.balls.find((b) => b.kind === "cue")?.x, resting.x, "normal turn does not respot cue");
  finish(m);
  console.log("PASS immediate acceptance, validation, duplicate/stale/wrong-turn rejection, cue position continuity");
}

{
  const { match: m } = fixture();
  m.seats[0]!.mods = { power: 2, size: 1, mass: 1, magnet: 2, slick: 1 };
  m.seats[0]!.curses = { grip: 1, swell: 2, shrink: 1, light: 1 };
  m.sim.applyMods(m.seats[0]!.mods, m.seats[0]!.curses);
  const predicted = clone(m.sim);
  const input = request(m, { ax: 1, az: 0.1, power: 0.8, loft: 0.18 });
  startShot(predicted, normalizeShot(input)!, predicted.mods);
  m.shot(0, input);
  for (let step = 1; step <= 120; step++) {
    stepShot(predicted, step, []); collectScore(predicted);
    m.advance(STEP);
  }
  assert.deepEqual(snapshotBalls(predicted), snapshotBalls(m.sim), "prediction and server must match all physical fields");
  const resumed = clone(m.sim);
  for (let step = 121; step <= 180; step++) {
    stepShot(predicted, step, []); collectScore(predicted);
    stepShot(resumed, step, []); collectScore(resumed);
    m.advance(STEP);
  }
  assert.deepEqual(snapshotBalls(resumed), snapshotBalls(predicted), "mid-shot snapshot resumes deterministically");
  finish(m);
  console.log("PASS shared deterministic physics, buffs/curses, moving snapshot restoration");
}

{
  const { match: m, inbox } = fixture();
  for (let shot = 0; shot < 6; shot++) play(m);
  assert.equal(m.phase, "draft");
  assert.deepEqual(m.seats.map((s) => s?.shots), [3, 3]);
  const revision = m.revision;
  m.offers = [["grip", "power", "size"], ["light", "mass", "magnet"]];
  m.pick(0, "grip", revision);
  m.pick(0, "power", revision);
  assert.equal(m.seats[1]?.curses.grip, 1);
  assert.equal(m.seats[0]?.mods.power, 0);
  m.pick(1, "light", revision);
  assert.equal(m.seats[0]?.curses.light, 1);
  assert.equal(m.phase, "aim");
  assert.equal(m.round, 7);
  assert.equal(m.turn, 0);
  assert.equal(inbox[0].at(-1)?.t, "state");
  const mods = { power: 4, size: 4, mass: 4, magnet: 4, slick: 4 };
  const curses = { grip: 4, swell: 4, shrink: 4, light: 4 };
  assert.equal(availableCards(mods, curses, true).length, 0);
  mods.power = 3;
  assert.deepEqual(availableCards(mods, curses, true).map((u) => u.id), ["power"]);
  applyCard(mods, curses, "power"); applyCard(mods, curses, "power");
  assert.equal(mods.power, CARD_CAP);
  console.log("PASS six-shot drafts, simultaneous choices, curse routing, duplicate picks and capped cards");
}

{
  const { match: m } = fixture();
  m.rules.breakShot = false;
  m.rules.groups = ["solids", "stripes"];
  for (const b of m.sim.balls) if (b.kind === "enemy" && b.number !== 8) { b.pocketed = true; b.scored = true; }
  const target = m.sim.balls.find(b => b.number === 8)!;
  target.pos.set(0, TABLE.feltY + target.radius, 1.45);
  const cue = m.sim.balls.find(b => b.kind === "cue")!;
  cue.pos.set(0, TABLE.feltY + cue.radius, 0.6);
  assert.ok(m.shot(0, request(m, { ax: 0, az: 1, power: 0.18, loft: 0 })));
  finish(m);
  assert.equal(m.phase, "over");
  assert.equal(m.winner, 0);
  assert.equal(m.seats[0]?.score, 100);
  assert.equal(m.join("丙", () => {}), null, "completed matches cannot be inherited by newcomers");
  const oldGame = m.game, oldRevision = m.revision;
  const oldIds = new Set(m.sim.balls.map(b => b.id));
  const oldRequest = m.seats[0]!.lastRequest;
  m.seats[0]!.mods.power = 2; m.seats[1]!.curses.grip = 2;
  m.offers = [["power"], ["mass"]]; m.picked = ["power", "mass"];
  assert.equal(m.rematch(0, oldGame - 1), false, "stale game votes must be rejected");
  assert.ok(m.rematch(0, oldGame));
  assert.equal(m.phase, "over", "one vote must not restart the other player");
  assert.deepEqual(m.stateFor(0).rematchReady, [true, false]);
  const votedRevision = m.revision;
  assert.equal(m.rematch(0, oldGame), false, "duplicate votes are idempotent");
  assert.equal(m.revision, votedRevision);
  assert.ok(m.rematch(1, oldGame), "both players may vote with the same game number");
  const restarted = m.stateFor(0);
  assert.equal(restarted.room, "TEST"); assert.deepEqual(restarted.names, ["甲", "乙"]);
  assert.equal(restarted.game, oldGame + 1); assert.equal(restarted.phase, "aim");
  assert.equal(restarted.turn, 1, "the opening player alternates between games");
  assert.ok(restarted.revision > oldRevision); assert.equal(restarted.round, 1);
  assert.deepEqual(restarted.scores, [0, 0]); assert.deepEqual(restarted.pockets, [0, 0]); assert.deepEqual(restarted.shots, [0, 0]);
  assert.deepEqual(restarted.mods, [emptyMods(), emptyMods()]); assert.deepEqual(restarted.curses, [emptyCurses(), emptyCurses()]);
  assert.equal(restarted.winner, null); assert.ok(restarted.rules.breakShot);
  assert.equal(restarted.rules.ballInHand, null); assert.deepEqual(restarted.rules.groups, [null, null]);
  assert.deepEqual(m.offers, [null, null]); assert.deepEqual(m.picked, [null, null]); assert.equal(restarted.lastPicks, null);
  assert.deepEqual(restarted.rematchReady, [false, false]); assert.equal(restarted.canRematch, false);
  assert.equal(restarted.balls.length, 16); assert.ok(restarted.balls.every(b => !b.pocketed && b.asleep && !oldIds.has(b.id)));
  assert.equal(m.seats[0]!.lastRequest, oldRequest, "request IDs must not be reused across rematches");
  assert.equal(m.shot(0, request(m, { requestId: oldRequest, revision: oldRevision })), false);
  assert.equal(m.rematch(0, oldGame), false);
  assert.ok(m.shot(1, request(m)));
  assert.ok(m.activeShot!.id > 1, "shot IDs stay monotonic across rematches");
  finish(m);
  console.log("PASS mutual rematch, same seats/room, clean rack/cards/rules, alternating break and stale-packet rejection");
  const { match: left } = fixture();
  left.shot(0, request(left)); left.leave(0);
  assert.equal(left.winner, 1);
  assert.equal(left.phase, "over");
  assert.equal(left.activeShot, null);
  assert.equal(left.join("丙", () => {}), null);
  assert.equal(left.stateFor(1).canRematch, false);
  assert.equal(left.rematch(1, left.game), false, "a disconnected opponent cannot be silently replaced");
  console.log("PASS legal-eight victory, no premature rerack and disconnect forfeit");
}

{
  const { match: m } = fixture();
  const cue = m.sim.balls.find((b) => b.kind === "cue")!;
  const object = m.sim.balls.find((b) => b.kind === "enemy")!;
  object.pos.set(kitchenX(), TABLE.feltY + object.radius, 0);
  const objectPos = object.pos.clone();
  cue.pocketed = true;
  m.sim.applyMods(emptyMods(), emptyCurses());
  respotCue(m.sim);
  assert.ok(cue.pos.distanceTo(object.pos) > cue.radius + object.radius);
  assert.deepEqual(object.pos, objectPos, "respot must not move an object ball");
  const s = new Sim();
  const a = makeBall("cue", 0, 0.12, 1, 99, null, 0, 1.04, 0);
  const b = makeBall("enemy", 1, 0.12, 1, 0.01, null, 0.235, 1.04, 0);
  a.vel.x = 18; a.asleep = false; s.balls = [a, b]; s.pocketsLive = false;
  const hits: Impact[] = [];
  s.step(STEP, hits);
  assert.ok(!b.shattered, "eight-ball must never destroy an object ball");
  assert.equal(hits.filter((h) => h.kind === "smash").length, 0);
  assert.equal(collectScore(s).length, 0, "no double scoring");
  a.sinking = true; a.sinkT = 0.1;
  stopShot(s);
  assert.ok(a.pocketed && !a.sinking);
  assert.equal(collectScore(s).length, 0, "scratch never awards points");
  console.log("PASS no destruction, single scoring, safe respot and timeout with sinking cue");
}

physicsCards();
console.log("All physics/rules/online selftests passed");


function speedAfter(mods: Mods, curses: Curses, seconds: number): number {
  const sim = new Sim();
  sim.walls = [];
  sim.pocketsLive = false;
  const ball = makeBall("enemy", 1, BALL.radius, BALL.mass, 5, null, -3.6, TABLE.feltY + BALL.radius, 0);
  ball.vel.set(3, 0, 0);
  ball.asleep = false;
  sim.balls = [ball];
  sim.applyMods(mods, curses);
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) sim.step(1 / 60, []);
  return Math.hypot(ball.vel.x, ball.vel.z);
}

function physicsCards(): void {
  const none = emptyMods();
  const clean = emptyCurses();
  const base = speedAfter(none, clean, 2.2);
  const grip1 = speedAfter(none, { ...clean, grip: 1 }, 2.2);
  const grip4 = speedAfter(none, { ...clean, grip: CARD_CAP }, 2.2);
  const slick1 = speedAfter({ ...none, slick: 1 }, clean, 2.2);
  const slick4 = speedAfter({ ...none, slick: CARD_CAP }, clean, 2.2);
  if (!(grip4 < 0.35)) fail(`max grip still moving ${grip4.toFixed(2)}`);
  if (!(grip1 < base * 0.55)) fail(`grip1 ${grip1.toFixed(2)} not slower than base ${base.toFixed(2)}`);
  if (!(slick1 > base * 1.2)) fail(`slick1 ${slick1.toFixed(2)} not faster than base ${base.toFixed(2)}`);
  if (!(slick4 > slick1 * 1.12 && slick4 > base * 1.45)) fail(`slick4 ${slick4.toFixed(2)} slick1 ${slick1.toFixed(2)} base ${base.toFixed(2)}`);
  if (!(feltScale(none, { ...clean, grip: 4 }) > feltScale(none, { ...clean, grip: 1 }) * 2)) fail("grip curve");
  if (!(feltScale({ ...none, slick: 4 }, clean) < feltScale({ ...none, slick: 1 }, clean) * 0.5)) fail("slick curve");

  const even = strike(1, 1);
  const light = strike(cueLightMul({ ...clean, light: CARD_CAP }), 1);
  if (!(even.target > 2.4)) fail(`equal-mass target only ${even.target.toFixed(2)}`);
  if (!(light.target < even.target * 0.45)) fail(`light cue still hits hard ${light.target.toFixed(2)} vs ${even.target.toFixed(2)}`);
  if (!(light.cue < -0.4)) fail(`light cue did not rebound ${light.cue.toFixed(2)}`);

  const shrunk = cueShrinkMul({ ...clean, shrink: CARD_CAP });
  const swelled = enemyRadiusMul({ ...clean, swell: CARD_CAP });
  if (!(shrunk < 0.35 && shrunk > 0.2)) fail(`shrink mul ${shrunk}`);
  if (!(swelled > 1.9 && swelled < 2.1)) fail(`swell mul ${swelled}`);
  const fit = pocketFate(BALL.radius * swelled);
  const oversize = pocketFate(0.26);
  if (!fit) fail("max swell ball should still fall into the pocket");
  if (oversize) fail("a ball wider than the pocket fell in");

  const sim = new Sim();
  sim.standardPool = false; // Legacy geometry helper remains isolated from eight-ball.
  sim.pocketsLive = false;
  const r = BALL.radius * swelled;
  const a = makeBall("enemy", 1, BALL.radius, 1, 2, null, 0, TABLE.feltY + r, 0);
  const b = makeBall("enemy", 2, BALL.radius, 1, 2, null, r, TABLE.feltY + r, 0);
  sim.balls = [a, b];
  sim.applyMods(none, { ...clean, swell: CARD_CAP });
  const gap = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  if (gap + 0.004 < a.radius + b.radius) fail(`swollen balls overlap ${gap.toFixed(3)} vs ${a.radius + b.radius}`);
  if (Math.abs(a.radius - r) > 1e-4) fail("swell radius not applied");
}

function strike(cueMass: number, targetMass: number): { cue: number; target: number } {
  const sim = new Sim();
  sim.walls = [];
  sim.pocketsLive = false;
  const cue = makeBall("cue", 0, BALL.radius, cueMass, 9, null, 0, TABLE.feltY + BALL.radius, 0);
  const target = makeBall("enemy", 1, BALL.radius, targetMass, 5, null, BALL.radius * 2 - 0.01, TABLE.feltY + BALL.radius, 0);
  cue.vel.set(5, 0, 0);
  cue.asleep = false;
  target.asleep = false;
  sim.balls = [cue, target];
  for (let i = 0; i < 8; i += 1) sim.step(1 / 60, []);
  return { cue: cue.vel.x, target: target.vel.x };
}

function pocketFate(radius: number): boolean {
  const sim = new Sim();
  sim.walls = [];
  const ball = makeBall("enemy", 1, radius, 1, 5, null, -TABLE.length / 2, TABLE.feltY + radius, -TABLE.width / 2);
  ball.vel.set(0.2, 0, 0.2);
  ball.asleep = false;
  sim.balls = [ball];
  for (let i = 0; i < 20; i += 1) sim.step(1 / 60, []);
  return ball.sinking || ball.pocketed;
}
