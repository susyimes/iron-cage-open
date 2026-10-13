import assert from "node:assert/strict";
import { BALL, TABLE } from "../../client/src/game/config.ts";
import { groupOf, judgeShot, newPoolRules, traceContacts, type PoolRules, type ShotTrace } from "../../client/src/game/rules.ts";
import { makeBall, Sim } from "../../client/src/game/physics.ts";
import { MAX_SHOT_STEPS, placeCue, STEP, stepShot, type ShotResult } from "../../client/src/game/shot.ts";
import { availableCards, emptyCurses, emptyMods, feltScale } from "../../client/src/game/upgrades.ts";
import { Match } from "./match.ts";

const full = Array.from({ length: 15 }, (_, i) => i + 1);
const trace = (first: number | null = 1, rail = true, remaining = full): ShotTrace => ({ remaining, firstContact: first, railAfterContact: rail, objectRails: new Set([1, 2, 3, 4]), pocketOrder: [] });
const result = (numbers: number[] = [], scratch = false): ShotResult => ({ events: numbers.map(number => ({ id: number, number, kind: "pocket", points: 100 })), pockets: numbers.length, smashed: 0, points: numbers.length * 100, scratch });
const open = (): PoolRules => ({ ...newPoolRules(), breakShot: false });
const assigned = (): PoolRules => ({ ...open(), groups: ["solids", "stripes"] });

{
  const rules = newPoolRules();
  assert.ok(judgeShot(rules, 0, trace(), result([1])).keepTurn);
  assert.deepEqual(rules.groups, [null, null], "the break must leave the table open");
  const legal = judgeShot(rules, 0, trace(9), result([10, 1]));
  assert.equal(legal.points, 100, "opponent-colour balls do not score for the shooter");
  assert.ok(legal.keepTurn);
  assert.deepEqual(rules.groups, ["stripes", "solids"]);
  assert.ok(!judgeShot(rules, 0, trace(9), result([2])).keepTurn, "only an opponent ball ends the inning");
  const badBreak = trace(); badBreak.objectRails = new Set([1, 2, 3]);
  assert.match(judgeShot(newPoolRules(), 0, badBreak, result()).foul!, /四颗/);
  const eightBreak = newPoolRules();
  const ruling = judgeShot(eightBreak, 0, trace(), result([8]));
  assert.ok(ruling.respotEight && ruling.keepTurn && ruling.winner === null);
  const scratchedBreak = judgeShot(newPoolRules(), 0, trace(), result([8], true));
  assert.ok(scratchedBreak.respotEight && scratchedBreak.foul && scratchedBreak.winner === null);
  assert.equal(judgeShot(newPoolRules(), 0, trace(), result([1, 8])).points, 100, "spotting the break eight does not cancel other legal pocket points");
  const sameFrame = trace(1); sameFrame.pocketOrder = [9, 1];
  const chronological = open(); judgeShot(chronological, 0, sameFrame, result([1, 9]));
  assert.equal(chronological.groups[0], "stripes", "same-frame pockets must assign by collision event order, not ball id");
  console.log("PASS legal/illegal breaks, open table, ordered group assignment and own-group continuation");
}
{
  for (const [name, contact, pockets, scratch] of [
    ["未碰到目标球", trace(null), [], false],
    ["先碰错球", trace(9), [], false],
    ["先碰错球", trace(8), [], false],
    ["碰球后无球进袋或碰库", trace(1, false), [], false],
    ["白球落袋", trace(1), [1], true],
  ] as const) {
    const rules = assigned();
    const ruling = judgeShot(rules, 0, contact, result([...pockets], scratch));
    assert.equal(ruling.foul, name); assert.equal(rules.ballInHand, 1);
    assert.ok(!ruling.keepTurn); assert.equal(ruling.points, 0);
  }
  const rules = open();
  judgeShot(rules, 0, trace(1), result([1], true));
  assert.deepEqual(rules.groups, [null, null], "a foul cannot assign a group");
  assert.ok(judgeShot(open(), 0, trace(8), result()).foul, "black cannot be the first contact on an open table");
  assert.equal(judgeShot(assigned(), 0, trace(1, true), result()).foul, null);
  const cue = makeBall("cue", 0, BALL.radius, 1, 99, null, 0, 1.04, 0);
  const ball = makeBall("enemy", 1, BALL.radius, 1, 99, null, 1, 1.04, 0);
  const ordered = trace(null, false); ordered.objectRails.clear();
  traceContacts(ordered, [{ kind: "cushion", speed: 1, x: 0, y: 1, z: 0, a: cue }, { kind: "ball", speed: 1, x: 0, y: 1, z: 0, a: cue, b: ball }]);
  assert.equal(ordered.firstContact, 1); assert.ok(!ordered.railAfterContact, "a rail before first contact is insufficient");
  console.log("PASS scratch, wrong/no first contact, no post-contact rail, foul pots and free-ball grants");
}
{
  assert.equal(judgeShot(assigned(), 0, trace(8, false, [8, 9]), result([8])).winner, 0);
  assert.equal(judgeShot(assigned(), 0, trace(8, false, [8, 9]), result([8], true)).winner, 1);
  assert.equal(judgeShot(assigned(), 0, trace(1), result([8])).winner, 1);
  assert.equal(judgeShot(assigned(), 0, trace(1, false, [1, 8, 9]), result([1, 8])).winner, 0, "last colour and black may be finished on the same shot");
  assert.equal(judgeShot(open(), 0, trace(1), result([8])).winner, 1);
  assert.equal(judgeShot(assigned(), 0, trace(9, true, [8, 9]), result()).foul, "先碰错球");
  console.log("PASS legal black, early black, black with scratch and separate final-colour/black shots");
}
{
  const clear = judgeShot(assigned(), 0, trace(1, true, [1, 8, 9]), result([1, 8]));
  assert.equal(clear.winner, 0, "(a) last own ball and black on the same legal shot is a same-shot clearance win");
  assert.equal(clear.summary, "一杆清台 · 合法打进黑 8，获胜");
  assert.equal(clear.points, 200, "the final colour still scores alongside the win bonus");
  const early = judgeShot(assigned(), 0, trace(1, true, [1, 2, 8, 9]), result([8]));
  assert.equal(early.winner, 1, "(b) black with own colours still on the table loses");
  assert.equal(early.summary, "提前打进黑 8，判负");
  const scratched = judgeShot(assigned(), 0, trace(1, true, [1, 8, 9]), result([1, 8], true));
  assert.equal(scratched.winner, 1, "(c) black plus a scratch loses even on a would-be clearance");
  assert.equal(scratched.summary, "白球落袋且黑 8 进袋，判负");
  const finished = judgeShot(assigned(), 0, trace(8, true, [8, 9]), result([8]));
  assert.equal(finished.winner, 0, "(d) black after the group was already cleared wins");
  assert.equal(finished.summary, "合法打进黑 8，获胜");
  const openBlack = judgeShot(open(), 0, trace(1), result([8]));
  assert.equal(openBlack.winner, 1, "(e) black on an open table loses");
  assert.equal(openBlack.summary, "提前打进黑 8，判负");
  const wrongFirst = judgeShot(assigned(), 0, trace(8, true, [1, 8, 9]), result([1, 8]));
  assert.equal(wrongFirst.foul, "先碰错球");
  assert.equal(wrongFirst.winner, 1, "(f) clearing on the same shot but hitting the black first loses");
  assert.equal(wrongFirst.summary, "先碰错球且黑 8 进袋，判负");
  console.log("PASS same-shot clearance win, early/scratched/open/wrong-first black losses and winner summaries");
}

function match() { const m = new Match("RULE", 1); m.join("甲", () => {}); m.join("乙", () => {}); return m; }
function fire(m: Match, power = 0.13, ax = -1, az = 0.07) {
  if (m.rules.ballInHand !== null) { const cue = m.sim.balls.find(b => b.kind === "cue")!; assert.ok(m.place(m.turn, cue.pos.x, cue.pos.z, m.revision)); }
  const shooter = m.turn;
  assert.ok(m.shot(shooter, { t: "shot", requestId: m.seats[shooter]!.lastRequest + 1, revision: m.revision, ax, az, power, loft: 0 }));
  let steps = 0;
  while (m.activeShot && steps++ < MAX_SHOT_STEPS + 1) m.advance(STEP);
  assert.equal(m.activeShot, null);
  return steps;
}
{
  const m = match();
  m.phase = "draft"; m.offers = [["grip"], ["power"]];
  const positions = m.sim.balls.map(b => b.pos.toArray());
  assert.ok(m.pick(0, "grip", m.revision));
  assert.deepEqual(m.seats[0]!.curses, emptyCurses(), "picker must not inherit their own curse");
  assert.equal(m.seats[1]!.curses.grip, 1);
  assert.ok(m.pick(1, "power", m.revision));
  assert.equal(m.sim.feltGrip, 1, "player zero's shot uses their clean cloth");
  assert.deepEqual(m.sim.balls.map(b => b.pos.toArray()), positions, "draft does not rearrange the layout");
  fire(m);
  assert.equal(m.turn, 1);
  assert.equal(m.sim.feltGrip, feltScale(m.seats[1]!.mods, m.seats[1]!.curses));
  assert.equal(m.sim.mods.power, 1);
  fire(m);
  assert.equal(m.turn, 0); assert.equal(m.sim.feltGrip, 1); assert.equal(m.sim.mods.power, 0);
  const cue = m.sim.balls.find(b => b.kind === "cue")!;
  const objects = m.sim.balls.filter(b => b.kind === "enemy").map(b => b.pos.toArray());
  assert.equal(m.place(1, 0, 0, m.revision), false, "opponent may not place cue");
  assert.equal(m.place(0, NaN, 0, m.revision), false);
  assert.equal(m.place(0, 10, 0, m.revision), false);
  const occupied = m.sim.live().find(b => b.kind === "enemy")!;
  assert.equal(m.place(0, occupied.pos.x, occupied.pos.z, m.revision), false);
  assert.equal(m.place(0, 0, 0, m.revision - 1), false);
  const revision = m.revision;
  assert.ok(m.place(0, cue.pos.x, cue.pos.z, revision));
  assert.equal(m.place(0, 0, 0, revision), false, "duplicate placement cannot move the ball twice");
  assert.deepEqual(m.sim.balls.filter(b => b.kind === "enemy").map(b => b.pos.toArray()), objects);
  assert.ok(!availableCards(emptyMods(), emptyCurses(), true).some(c => ["size", "shrink", "swell"].includes(c.id)));
  console.log("PASS real two-turn curse isolation, restoration, stationary draft and validated cue placement");
}
{
  const m = match();
  m.rules.breakShot = false;
  for (const b of m.sim.balls) {
    if (b.kind === "enemy" && ![1, 8, 9].includes(b.number)) { b.pocketed = b.scored = true; }
    if (b.number === 1) b.pos.set(0, TABLE.feltY + b.radius, 1.45);
    if (b.number === 8) b.pos.set(-2, TABLE.feltY + b.radius, -1);
    if (b.number === 9) b.pos.set(2, TABLE.feltY + b.radius, -1);
  }
  assert.ok(placeCue(m.sim, 0, 0.6));
  fire(m, 0.18, 0, 1);
  assert.equal(m.turn, 0); assert.equal(m.seats[0]!.score, 100);
  assert.deepEqual(m.rules.groups, ["solids", "stripes"]);
  assert.equal(m.rules.ballInHand, null);
  assert.equal(m.sim.live().filter(b => groupOf(b.number) === "solids").length, 0);
  console.log("PASS physical pocket, group assignment and consecutive-shot ownership through Match");
}
{
  const m = match();
  const table = m.sim.balls.map(b => b.pos.toArray());
  m.sim.applyMods({ ...emptyMods(), size: 4 }, { ...emptyCurses(), swell: 4, shrink: 4 });
  assert.deepEqual(m.sim.balls.map(b => b.pos.toArray()), table, "even stale size metadata cannot move an eight-ball table");
  assert.ok(m.sim.balls.every(b => b.radius === BALL.radius));
  const resting = new Sim(); resting.pocketsLive = false;
  resting.balls = [makeBall("cue", 0, BALL.radius, 1, 99, null, 0, 1.04, 0), makeBall("enemy", 1, BALL.radius, 1, 99, null, BALL.radius * 2 - 1e-10, 1.04, 0)];
  resting.balls.forEach(b => { b.asleep = false; b.stillTime = 0; });
  let steps = 0;
  while (++steps < 120 && !stepShot(resting, steps, [])) {}
  assert.ok(steps < 40, `resting contacts took ${steps} steps`);
  const duration = [];
  for (const magnet of [0, 2, 4]) {
    const game = match(); game.seats[0]!.mods.magnet = magnet; game.sim.applyMods(game.seats[0]!.mods);
    const elapsed = fire(game, 0.14);
    assert.ok(elapsed < 360, `short shot with magnet ${magnet} took ${elapsed} steps`);
    duration.push({ magnet, seconds: elapsed * STEP });
  }
  console.log("PASS no geometry reshuffle, resting-contact sleep and bounded magnet settlement", duration);
}
