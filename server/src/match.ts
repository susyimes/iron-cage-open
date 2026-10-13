import { BALL, EIGHT_BALL_RACK, TABLE, enemyHp, kitchenX, rackApexX, triangleRack } from "../../client/src/game/config.ts";
import { Sim, buildCushionWalls, makeBall, type Impact } from "../../client/src/game/physics.ts";
import { collectScore, DRAFT_ROUNDS, normalizeShot, placeCue, respotBall, respotCue, resultOf, snapshotBalls, startShot, STEP, stepShot, stopShot, type ScoreEvent } from "../../client/src/game/shot.ts";
import { beginTrace, groupOf, judgeShot, newPoolRules, targetText, traceContacts, type ShotTrace } from "../../client/src/game/rules.ts";
import { applyCard, availableCards, emptyCurses, emptyMods, mulberry32, offerThree, type Curses, type Mods, type UpgradeId } from "../../client/src/game/upgrades.ts";
import type { ActiveShot, ClientMsg, PublicState, ServerMsg } from "./protocol.ts";

export type Seat = {
  name: string; mods: Mods; curses: Curses; score: number; pockets: number; shots: number;
  lastRequest: number; send: (msg: ServerMsg) => void;
};

export class Match {
  seats: Array<Seat | null> = [null, null];
  sim = new Sim();
  phase: PublicState["phase"] = "wait";
  turn = 0;
  round = 1;
  revision = 0;
  game = 1;
  private rematchReady: [boolean, boolean] = [false, false];
  private openingTurn = 0;
  winner: number | null = null;
  rules = newPoolRules();
  offers: [UpgradeId[] | null, UpgradeId[] | null] = [null, null];
  picked: [UpgradeId | null, UpgradeId | null] = [null, null];
  private lastPicks: [UpgradeId | null, UpgradeId | null] | null = null;
  activeShot: ActiveShot | null = null;
  private rng: () => number;
  private nextShot = 1;
  private acc = 0;
  private events: ScoreEvent[] = [];
  private trace: ShotTrace | null = null;
  private endedByLeave = false;

  constructor(readonly room: string, seed = 1) {
    this.rng = mulberry32(seed);
    this.resetTable();
  }

  private resetTable(): void {
    this.sim = new Sim();
    this.sim.walls = buildCushionWalls();
    this.sim.balls.push(makeBall("cue", 0, BALL.radius, BALL.mass, 99, null, kitchenX(), TABLE.feltY + BALL.radius, 0));
    this.rack(1);
  }

  join(name: string, send: Seat["send"]): number | null {
    if (this.phase !== "wait") return null;
    const index = this.seats.findIndex((s) => !s);
    if (index < 0) return null;
    this.seats[index] = { name: name.trim().slice(0, 16) || "玩家 " + (index + 1), mods: emptyMods(), curses: emptyCurses(), score: 0, pockets: 0, shots: 0, lastRequest: 0, send };
    if (this.seats.every(Boolean)) { this.phase = "aim"; this.prepareTurn(); }
    this.revision++;
    this.broadcast();
    return index;
  }

  leave(index: number): void {
    this.seats[index] = null;
    this.rematchReady = [false, false];
    if (this.phase !== "wait" && this.phase !== "over") {
      this.phase = "over";
      this.activeShot = null;
      this.winner = 1 - index;
      this.endedByLeave = true;
      stopShot(this.sim);
    }
    this.revision++;
    this.broadcast();
  }

  rematch(index: number, game: number): boolean {
    const seat = this.seats[index];
    if (!seat) return false;
    if (!Number.isSafeInteger(game) || game !== this.game || this.phase !== "over" || !this.seats.every(Boolean)) {
      seat.send({ t: "error", message: this.seats.every(Boolean) ? "当前不能重开，请等待本局结束" : "对手已离开，请返回主界面重新联机", state: this.stateFor(index) });
      return false;
    }
    if (this.rematchReady[index]) return false;
    this.rematchReady[index] = true;
    if (this.rematchReady.every(Boolean)) {
      this.game++;
      this.openingTurn = 1 - this.openingTurn;
      this.turn = this.openingTurn;
      this.round = 1;
      this.winner = null;
      this.rules = newPoolRules();
      this.offers = [null, null];
      this.picked = [null, null];
      this.lastPicks = null;
      this.rematchReady = [false, false];
      this.activeShot = null;
      this.acc = 0;
      this.events = [];
      this.trace = null;
      this.endedByLeave = false;
      for (const player of this.seats) {
        if (!player) continue;
        player.mods = emptyMods(); player.curses = emptyCurses();
        player.score = player.pockets = player.shots = 0;
      }
      // Keep sockets, seats and request/shot counters; delayed packets stay stale.
      this.resetTable();
      this.phase = "aim";
      this.prepareTurn();
    }
    this.revision++;
    this.broadcast();
    return true;
  }

  shot(index: number, input: Extract<ClientMsg, { t: "shot" }>): boolean {
    const seat = this.seats[index];
    if (!seat) return false;
    const reject = (message: string) => { seat.send({ t: "error", message, requestId: input.requestId, state: this.stateFor(index) }); return false; };
    if (!Number.isSafeInteger(input.requestId) || input.requestId <= seat.lastRequest) return reject("重复或过期的出杆，请等待当前回合");
    if (this.phase !== "aim" || this.turn !== index || !this.seats.every(Boolean)) return reject("现在不能出杆");
    if (input.revision !== this.revision) return reject("球台状态已更新，请重新瞄准");
    if (this.rules.ballInHand !== null) return reject("自由球：请先在球台上摆放白球");
    const shot = normalizeShot(input);
    if (!shot) return reject("出杆参数无效");
    seat.lastRequest = input.requestId;
    this.phase = "rolling";
    this.activeShot = { id: this.nextShot++, requestId: input.requestId, shooter: index, input: shot, step: 0 };
    this.events = [];
    this.trace = beginTrace(this.sim);
    this.acc = 0;
    this.revision++;
    // Send before the first simulation step: no full-shot computation or frame download.
    this.seats.forEach((s, i) => s?.send({ t: "shot-start", shot: { ...this.activeShot! }, state: this.stateFor(i) }));
    startShot(this.sim, shot, seat.mods);
    return true;
  }

  /** Driven by a shared server clock; a rolling table cannot accept a second shot. */
  advance(dt: number): void {
    const shot = this.activeShot;
    if (!shot || this.phase !== "rolling") return;
    this.acc += Math.min(0.25, Math.max(0, dt));
    let budget = 8;
    while (this.acc + 1e-9 >= STEP && budget-- > 0 && this.activeShot) {
      this.acc -= STEP;
      shot.step++;
      const impacts: Impact[] = [];
      const done = stepShot(this.sim, shot.step, impacts);
      traceContacts(this.trace!, impacts);
      this.events.push(...collectScore(this.sim));
      if (done) this.finishShot();
    }
  }

  place(index: number, x: number, z: number, revision: number): boolean {
    const seat = this.seats[index];
    if (!seat) return false;
    if (this.phase !== "aim" || this.turn !== index || this.rules.ballInHand !== index || revision !== this.revision || !placeCue(this.sim, x, z)) {
      seat.send({ t: "error", message: "白球位置无效：请放在台内空位，避开球袋和彩球", state: this.stateFor(index) });
      return false;
    }
    this.rules.ballInHand = null;
    this.revision++;
    this.broadcast();
    return true;
  }

  pick(index: number, id: UpgradeId, revision: number): boolean {
    if (this.phase !== "draft") return false;
    // Both players can pick from the same revision, regardless of arrival order.
    const seat = this.seats[index];
    const foe = this.seats[1 - index];
    const offer = this.offers[index];
    if (!seat || !foe || revision !== this.revision || !offer?.includes(id) || this.picked[index]) return false;
    this.picked[index] = id;
    applyCard(seat.mods, foe.curses, id);
    if (this.offers.every((o, i) => !o?.length || this.picked[i])) {
      this.lastPicks = [...this.picked];
      this.offers = [null, null]; this.picked = [null, null];
      this.phase = "aim";
      this.prepareTurn();
      this.revision++;
    }
    this.broadcast();
    return true;
  }

  private finishShot(): void {
    const shot = this.activeShot!;
    const seat = this.seats[shot.shooter]!;
    const result = resultOf(this.events, this.sim);
    const ruling = judgeShot(this.rules, shot.shooter, this.trace!, result);
    result.ruling = ruling;
    result.points = ruling.points;
    seat.score += ruling.points;
    seat.pockets += result.pockets;
    seat.shots++;
    for (let i = 0; i < 2; i++) {
      const group = this.rules.groups[i];
      if (group) this.seats[i]!.pockets = 7 - this.sim.live().filter(b => b.kind === "enemy" && groupOf(b.number) === group).length;
    }
    if (ruling.respotEight) {
      const eight = this.sim.balls.find(b => b.number === 8)!;
      respotBall(this.sim, eight, rackApexX());
    }
    this.activeShot = null;
    this.acc = 0;
    if (ruling.winner !== null) {
      this.winner = ruling.winner;
      this.phase = "over";
    } else {
      this.turn = ruling.keepTurn ? shot.shooter : 1 - shot.shooter;
      const totalShots = this.seats[0]!.shots + this.seats[1]!.shots;
      this.round = totalShots + 1;
      this.phase = "aim";
      this.prepareTurn();
      if (totalShots % (DRAFT_ROUNDS * 2) === 0) {
        this.lastPicks = null;
        this.offers = this.seats.map((s, i) => offerThree(this.rng, availableCards(s!.mods, this.seats[1 - i]!.curses, true)).map((u) => u.id)) as typeof this.offers;
        this.picked = [null, null];
        if (this.offers.some((o) => o?.length)) this.phase = "draft";
      }
    }
    this.revision++;
    this.seats.forEach((s, i) => s?.send({ t: "shot-end", shotId: shot.id, steps: shot.step, result, state: this.stateFor(i) }));
  }

  private rack(wave: number): void {
    this.sim.balls = this.sim.balls.filter((b) => b.kind === "cue");
    triangleRack(15, BALL.radius, rackApexX()).forEach((p, i) => {
      this.sim.balls.push(makeBall("enemy", EIGHT_BALL_RACK[i] ?? i + 1, BALL.radius, BALL.mass, enemyHp(wave), null, p.x, TABLE.feltY + BALL.radius, p.z));
    });
    respotCue(this.sim);
  }

  private prepareTurn(): void {
    const seat = this.seats[this.turn];
    if (!seat) return;
    const cue = this.sim.balls.find((b) => b.kind === "cue")!;
    const scratch = cue.pocketed || cue.sinking;
    if (scratch) respotCue(this.sim);
    this.sim.applyMods(seat.mods, seat.curses);
    if (scratch) respotCue(this.sim);
  }

  stateFor(index: number): PublicState {
    const a = this.seats[0], b = this.seats[1];
    let status = "等待对手进入房间";
    if (this.phase === "aim") status = this.rules.ballInHand !== null
      ? this.turn === index ? "自由球 · 点击球台空位摆放白球" : "对方自由球 · 等待摆球"
      : (this.turn === index ? "轮到你 · " : "对方 · ") + targetText(this.rules, this.turn, this.sim.live().filter(b => b.kind === "enemy").map(b => b.number));
    if (this.phase === "rolling") status = this.turn === index ? "你的球正在滚动" : "对方击球中";
    if (this.phase === "draft") status = this.picked[index] || !this.offers[index]?.length ? "等待对方选卡" : "选择增强或使坏卡";
    if (this.phase === "over") status = this.endedByLeave ? "对手离开，你赢了" : (this.turn === index ? "你" : "对方") + (this.rules.last?.summary ?? "对局结束");
    return {
      room: this.room, you: index, revision: this.revision, phase: this.phase, turn: this.turn, round: this.round,
      game: this.game, rematchReady: [...this.rematchReady], canRematch: this.phase === "over" && this.seats.every(Boolean),
      rules: { ...this.rules, groups: [...this.rules.groups], last: this.rules.last ? { ...this.rules.last } : null },
      names: [a?.name ?? "等待加入", b?.name ?? "等待加入"], scores: [a?.score ?? 0, b?.score ?? 0], pockets: [a?.pockets ?? 0, b?.pockets ?? 0], shots: [a?.shots ?? 0, b?.shots ?? 0],
      mods: [{ ...(a?.mods ?? emptyMods()) }, { ...(b?.mods ?? emptyMods()) }], curses: [{ ...(a?.curses ?? emptyCurses()) }, { ...(b?.curses ?? emptyCurses()) }],
      balls: snapshotBalls(this.sim), activeShot: this.activeShot ? { ...this.activeShot } : null,
      offer: this.phase === "draft" ? this.offers[index]?.slice() ?? null : null,
      needPick: this.phase === "draft" && !!this.offers[index]?.length && !this.picked[index], winner: this.winner, status,
      lastPicks: this.lastPicks ? [...this.lastPicks] : null,
    };
  }

  broadcast(): void { this.seats.forEach((s, i) => s?.send({ t: "state", state: this.stateFor(i) })); }
}
