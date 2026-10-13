import type { Curses, Mods, UpgradeId } from "../../client/src/game/upgrades.ts";
import type { BallState, ShotInput, ShotResult } from "../../client/src/game/shot.ts";
import type { PoolRules } from "../../client/src/game/rules.ts";

export const PROTOCOL_VERSION = 4;
export const ROOM_IDLE_CLOSE_CODE = 4001;
export type ActiveShot = { id: number; requestId: number; shooter: number; input: ShotInput; step: number };
export type PublicState = {
  room: string; you: number; revision: number;
  game: number; rematchReady: [boolean, boolean]; canRematch: boolean;
  phase: "wait" | "aim" | "rolling" | "draft" | "over";
  turn: number; round: number;
  rules: PoolRules;
  names: [string, string]; scores: [number, number]; pockets: [number, number]; shots: [number, number];
  mods: [Mods, Mods]; curses: [Curses, Curses];
  balls: BallState[]; activeShot: ActiveShot | null;
  offer: UpgradeId[] | null; needPick: boolean; winner: number | null; status: string;
  lastPicks: [UpgradeId | null, UpgradeId | null] | null;
};

export type ServerMsg =
  | { t: "state"; state: PublicState }
  | { t: "shot-start"; shot: ActiveShot; state: PublicState }
  | { t: "shot-end"; shotId: number; steps: number; result: ShotResult; state: PublicState }
  | { t: "error"; message: string; requestId?: number; state?: PublicState }
  | { t: "pong"; sent: number };

export type ClientMsg =
  | { t: "join"; version: number; room: string; name: string }
  | ({ t: "shot"; requestId: number; revision: number } & ShotInput)
  | { t: "pick"; id: UpgradeId; revision: number }
  | { t: "place"; x: number; z: number; revision: number }
  | { t: "rematch"; game: number }
  | { t: "sync" }
  | { t: "ping"; sent: number };
