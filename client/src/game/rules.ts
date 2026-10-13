import type { Impact, Sim } from "./physics.ts";
import type { ShotResult } from "./shot.ts";

export type Group = "solids" | "stripes";
export type PoolRules = {
  groups: [Group | null, Group | null];
  breakShot: boolean;
  ballInHand: number | null;
  winner: number | null;
  last: Ruling | null;
};
export type Ruling = {
  foul: string | null;
  keepTurn: boolean;
  winner: number | null;
  respotEight: boolean;
  points: number;
  summary: string;
};
export type ShotTrace = {
  remaining: number[];
  firstContact: number | null;
  railAfterContact: boolean;
  objectRails: Set<number>;
  pocketOrder: number[];
};

export const groupOf = (number: number): Group | null => number >= 1 && number <= 7 ? "solids" : number >= 9 && number <= 15 ? "stripes" : null;
export const groupName = (group: Group | null): string => group === "solids" ? "全色 1–7" : group === "stripes" ? "花色 9–15" : "开放球台";
export const newPoolRules = (): PoolRules => ({ groups: [null, null], breakShot: true, ballInHand: null, winner: null, last: null });
export const beginTrace = (sim: Sim): ShotTrace => ({ remaining: sim.live().filter(b => b.kind === "enemy" && !b.sinking).map(b => b.number), firstContact: null, railAfterContact: false, objectRails: new Set(), pocketOrder: [] });

/** Consume ordered contacts from each fixed step, not a later view of ball positions. */
export function traceContacts(trace: ShotTrace, impacts: Impact[]): void {
  for (const hit of impacts) {
    if (hit.kind === "pocket" && hit.a?.kind === "enemy") trace.pocketOrder.push(hit.a.number);
    if (hit.kind === "ball" && trace.firstContact === null) {
      if (hit.a?.kind === "cue" && hit.b?.kind === "enemy") trace.firstContact = hit.b.number;
      else if (hit.b?.kind === "cue" && hit.a?.kind === "enemy") trace.firstContact = hit.a.number;
    }
    if ((hit.kind === "cushion" || hit.kind === "cage") && trace.firstContact !== null) {
      trace.railAfterContact = true;
      if (hit.a?.kind === "enemy") trace.objectRails.add(hit.a.number);
    }
  }
}

/** Recreational eight-ball: no called pockets; free placement anywhere after a foul.
 * The break never assigns groups and a break eight is spotted, never an instant win.
 * On an open table the first legally pocketed colour assigns the groups.
 */
export function judgeShot(rules: PoolRules, shooter: number, trace: ShotTrace, result: ShotResult): Ruling {
  const scored = result.events.filter(e => e.kind === "pocket").map(e => e.number);
  // Multiple balls can fall within the same 1/60 s frame. Use the substep event
  // order to assign colours, not the storage order used by collectScore.
  const potted = [...trace.pocketOrder.filter(n => scored.includes(n)), ...scored.filter(n => !trace.pocketOrder.includes(n))];
  const eight = potted.includes(8);
  const group = rules.groups[shooter] ?? null;
  const remaining = trace.remaining.filter(n => groupOf(n) === group && groupOf(n) !== null);
  let foul: string | null = result.scratch ? "白球落袋" : trace.firstContact === null ? "未碰到目标球" : null;
  if (!foul && !rules.breakShot) {
    const first = trace.firstContact!;
    if (group === null ? first === 8 : remaining.length ? groupOf(first) !== group : first !== 8) foul = "先碰错球";
  }
  if (!foul && rules.breakShot && !potted.length && trace.objectRails.size < 4) foul = "开球不足四颗彩球碰库";
  if (!foul && !potted.length && !trace.railAfterContact) foul = "碰球后无球进袋或碰库";
  const respotEight = rules.breakShot && eight;
  // "Group cleared" also covers a same-shot clearance: every group ball alive at
  // stroke time fell on this very shot, so the black is a legal finisher, not early.
  const clearedOnShot = remaining.length > 0 && remaining.every(n => potted.includes(n));
  let winner: number | null = null;
  if (eight && !rules.breakShot) winner = !foul && group !== null && (remaining.length === 0 || clearedOnShot) ? shooter : 1 - shooter;
  if (!rules.breakShot && !foul && !eight && group === null) {
    const assigned = potted.map(groupOf).find((g): g is Group => g !== null);
    if (assigned) { rules.groups[shooter] = assigned; rules.groups[1 - shooter] = assigned === "solids" ? "stripes" : "solids"; }
  }
  const own = potted.filter(n => rules.breakShot ? n !== 8 : groupOf(n) === rules.groups[shooter] && n !== 8).length;
  const keepTurn = winner === null && !foul && (own > 0 || respotEight);
  const points = foul || (winner !== null && winner !== shooter) ? 0 : own * 100 + (winner === shooter ? 100 : 0);
  const summary = winner !== null
    ? winner === shooter ? clearedOnShot ? "一杆清台 · 合法打进黑 8，获胜" : "合法打进黑 8，获胜" : foul ? `${foul}且黑 8 进袋，判负` : "提前打进黑 8，判负"
    : foul ? `${foul} · 对手自由球` : respotEight ? "开球黑 8 重置 · 继续出杆" : keepTurn ? "合法进球 · 继续出杆" : "本杆结束 · 交换球权";
  const ruling = { foul, keepTurn, winner, respotEight, points, summary };
  rules.breakShot = false;
  rules.ballInHand = foul && winner === null ? 1 - shooter : null;
  rules.winner = winner;
  rules.last = ruling;
  return ruling;
}

export function targetText(rules: PoolRules, player: number, numbers: number[]): string {
  if (rules.breakShot) return "开球 · 进球或至少四颗彩球碰库";
  const group = rules.groups[player] ?? null;
  if (group === null) return "开放球台 · 先合法进球确定花色";
  const left = numbers.filter(n => groupOf(n) === group).length;
  return left ? `${groupName(group)} · 剩余 ${left} 球` : "本组已清空 · 目标黑 8";
}
