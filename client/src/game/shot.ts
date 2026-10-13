import { Vector3 } from "three";
import { BALL, PHYS, SHOT, TABLE, kitchenX } from "./config.ts";
import { impulseCue, type Ball, type Impact, type Sim } from "./physics.ts";
import { powerMul, type Mods } from "./upgrades.ts";
import type { Ruling } from "./rules.ts";

export const STEP = 1 / 60;
export const MAX_SHOT_STEPS = Math.round(PHYS.maxRoll / STEP);
export const DRAFT_ROUNDS = 3;
export type ShotInput = { ax: number; az: number; power: number; loft: number };
export type BallState = {
  id: number; kind: Ball["kind"]; number: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  radius: number; mass: number; hp: number; maxHp: number;
  asleep: boolean; stillTime: number; sinking: boolean; sinkT: number;
  pocketed: boolean; shattered: boolean; scored: boolean;
  pocket: Ball["pocket"];
};
export type ScoreEvent = { id: number; number: number; kind: "pocket" | "smash"; points: number };
export type ShotResult = { events: ScoreEvent[]; pockets: number; smashed: number; points: number; scratch: boolean; ruling?: Ruling };

/** Network and solo shots go through exactly the same limits and impulse. */
export function normalizeShot(input: ShotInput): ShotInput | null {
  if (![input.ax, input.az, input.power, input.loft].every(Number.isFinite)) return null;
  const length = Math.hypot(input.ax, input.az);
  if (length < 1e-6 || !Number.isFinite(length) || input.power < SHOT.minCharge) return null;
  return {
    ax: Math.abs(length - 1) < 1e-12 ? input.ax : input.ax / length,
    az: Math.abs(length - 1) < 1e-12 ? input.az : input.az / length,
    power: Math.min(1, input.power),
    loft: Math.max(0, Math.min(SHOT.loftMax + SHOT.loftBoost, input.loft)),
  };
}

export function startShot(sim: Sim, input: ShotInput, mods: Mods): void {
  const cue = sim.balls.find((b) => b.kind === "cue" && !b.pocketed && !b.sinking);
  if (!cue) throw new Error("No playable cue ball");
  sim.shotSeconds = 0;
  impulseCue(cue, new Vector3(input.ax, 0, input.az), input.power * SHOT.maxSpeed * powerMul(mods), input.loft);
}

/** Complete falling balls too: a timeout must never leave a live, half-sunk ball. */
export function stopShot(sim: Sim): void {
  for (const b of sim.balls) {
    if (b.sinking) {
      b.sinking = false;
      b.pocketed = true;
      b.pos.y = TABLE.feltY - b.radius;
    }
    b.vel.set(0, 0, 0);
    b.omega.set(0, 0, 0);
    b.asleep = true;
    b.stillTime = 1;
    if (!b.pocketed && !b.shattered) b.pos.y = TABLE.feltY + b.radius;
    if (b.mesh) {
      b.mesh.position.copy(b.pos);
      b.mesh.visible = !b.pocketed && !b.shattered;
      b.mesh.scale.setScalar(b.radius);
    }
  }
}

export function stepShot(sim: Sim, step: number, impacts: Impact[]): boolean {
  sim.shotSeconds = (step - 1) * STEP;
  sim.step(STEP, impacts);
  const done = (step >= 8 && sim.allSleeping()) || step >= MAX_SHOT_STEPS;
  if (done) stopShot(sim);
  return done;
}

/** An object scores once. Cue scratches never count as a combo or a cleared ball. */
export function collectScore(sim: Sim, wave = 1): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  for (const b of sim.balls) {
    if (b.kind !== "enemy" || b.scored || (!b.sinking && !b.pocketed && !b.shattered)) continue;
    b.scored = true;
    const kind = b.shattered ? "smash" : "pocket";
    events.push({ id: b.id, number: b.number, kind, points: (kind === "pocket" ? 100 : 150) * wave });
  }
  return events;
}

export function resultOf(events: ScoreEvent[], sim: Sim): ShotResult {
  return {
    events: events.slice(), pockets: events.filter((e) => e.kind === "pocket").length,
    smashed: events.filter((e) => e.kind === "smash").length,
    points: events.reduce((sum, e) => sum + e.points, 0),
    scratch: sim.balls.some((b) => b.kind === "cue" && (b.pocketed || b.sinking)),
  };
}

export function snapshotBalls(sim: Sim): BallState[] {
  return sim.balls.map((b) => ({
    id: b.id, kind: b.kind, number: b.number,
    x: b.pos.x, y: b.pos.y, z: b.pos.z, vx: b.vel.x, vy: b.vel.y, vz: b.vel.z,
    radius: b.radius, mass: b.mass, hp: b.hp, maxHp: b.maxHp,
    asleep: b.asleep, stillTime: b.stillTime, sinking: b.sinking, sinkT: b.sinkT,
    pocketed: b.pocketed, shattered: b.shattered, scored: b.scored,
    pocket: b.pocket ? { ...b.pocket } : null,
  }));
}

export function restoreBall(ball: Ball, s: BallState): void {
  ball.id = s.id; ball.kind = s.kind; ball.number = s.number;
  ball.radius = s.radius; ball.mass = s.mass; ball.hp = s.hp; ball.maxHp = s.maxHp;
  ball.pos.set(s.x, s.y, s.z); ball.vel.set(s.vx, s.vy, s.vz);
  ball.asleep = s.asleep; ball.stillTime = s.stillTime;
  ball.sinking = s.sinking; ball.sinkT = s.sinkT;
  ball.pocketed = s.pocketed; ball.shattered = s.shattered; ball.scored = s.scored;
  ball.pocket = s.pocket ? { ...s.pocket } : null;
  if (ball.mesh) {
    ball.mesh.position.copy(ball.pos);
    ball.mesh.visible = !s.pocketed && !s.shattered;
    ball.mesh.scale.setScalar(s.radius * (s.sinking ? Math.max(0.12, 1 - s.sinkT * 2.1) : 1));
  }
}

/** Find an empty kitchen position without moving any of the object balls. */
export function respotCue(sim: Sim): void {
  const cue = sim.balls.find((b) => b.kind === "cue");
  if (!cue) return;
  respotBall(sim, cue, kitchenX());
}

/** Spotting the break eight or scratched cue must leave all other centres unchanged. */
export function respotBall(sim: Sim, cue: Ball, preferredX: number): void {
  const others = sim.live().filter((b) => b !== cue && !b.sinking);
  const candidates = [{ x: preferredX, z: 0 }];
  const spacing = Math.max(BALL.radius, cue.radius) * 0.65;
  for (let x = -TABLE.length / 2 + cue.radius + 0.1; x < TABLE.length / 2 - cue.radius - 0.1; x += spacing) {
    for (let z = -TABLE.width / 2 + cue.radius + 0.1; z < TABLE.width / 2 - cue.radius - 0.1; z += spacing) candidates.push({ x, z });
  }
  candidates.sort((a, b) => Math.hypot(a.x - preferredX, a.z) - Math.hypot(b.x - preferredX, b.z));
  const spot = candidates.find((p) => others.every((b) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) >= cue.radius + b.radius + 0.012));
  if (!spot) throw new Error("No free cue respot position");
  cue.pocketed = false; cue.sinking = false; cue.shattered = false; cue.scored = false;
  cue.sinkT = 0; cue.pocket = null;
  cue.pos.set(spot.x, TABLE.feltY + cue.radius, spot.z);
  cue.vel.set(0, 0, 0); cue.omega.set(0, 0, 0); cue.asleep = true; cue.stillTime = 1;
  if (cue.mesh) { cue.mesh.visible = true; cue.mesh.scale.setScalar(cue.radius); cue.mesh.position.copy(cue.pos); }
}

export function canPlaceCue(sim: Sim, x: number, z: number): boolean {
  const cue = sim.balls.find(b => b.kind === "cue");
  if (!cue || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const r = cue.radius;
  return Math.abs(x) <= TABLE.length / 2 - r - 0.025 && Math.abs(z) <= TABLE.width / 2 - r - 0.025 &&
    sim.pockets.every(p => Math.hypot(x - p.x, z - p.z) > p.r + r * 0.3) &&
    sim.live().every(b => b === cue || b.sinking || Math.hypot(x - b.pos.x, z - b.pos.z) >= r + b.radius + 0.012);
}

export function placeCue(sim: Sim, x: number, z: number): boolean {
  if (!canPlaceCue(sim, x, z)) return false;
  const cue = sim.balls.find(b => b.kind === "cue")!;
  cue.pocketed = cue.sinking = cue.shattered = cue.scored = false;
  cue.sinkT = 0; cue.pocket = null;
  cue.pos.set(x, TABLE.feltY + cue.radius, z);
  cue.vel.set(0, 0, 0); cue.omega.set(0, 0, 0); cue.asleep = true; cue.stillTime = 1;
  if (cue.mesh) { cue.mesh.visible = true; cue.mesh.position.copy(cue.pos); }
  return true;
}
