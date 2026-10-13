import assert from "node:assert/strict";
import { newPoolRules } from "../client/src/game/rules.ts";
import { Online } from "../client/src/net.ts";
import { emptyCurses, emptyMods } from "../client/src/game/upgrades.ts";
import { ROOM_IDLE_CLOSE_CODE, type PublicState, type ServerMsg } from "../server/src/protocol.ts";

// The message state machine does not need a renderer. Exercise duplicate and
// delayed messages explicitly; an ordered happy-path socket cannot expose these.
class Socket extends EventTarget {
  static OPEN = 1;
  static current: Socket;
  readyState = 1;
  sent: unknown[] = [];
  constructor(_url: string) { super(); Socket.current = this; }
  send(message: string): void { this.sent.push(JSON.parse(message)); }
  close(code = 1000): void { this.readyState = 3; this.dispatchEvent(Object.assign(new Event("close"), { code })); }
  receive(message: ServerMsg): void { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}
const doc = Object.assign(new EventTarget(), { hidden: false });
Object.assign(globalThis, { window: { setTimeout, clearTimeout, setInterval, clearInterval }, document: doc, location: { protocol: "http:", host: "test" }, WebSocket: Socket });
let syncs = 0, starts = 0, rounds = 0;
const notices: string[] = [];
const game = {
  onlineState: null as PublicState | null, online: false, myTurn: true, phase: "aim", screen: "play", offer: null as unknown, status: "",
  isPlayingShot: false, mods: emptyMods(), curses: emptyCurses(), sim: { mods: emptyMods(), feltGrip: 1, pocketsLive: false, standardPool: false },
  input: { reset() {} },
  onHud() {}, onNetShot: null as ((s: { ax: number; az: number; power: number; loft: number }) => boolean) | null,
  onNetPlace: null as ((x: number, z: number) => boolean) | null,
  onNetRematch: null as (() => boolean) | null,
  onPlaybackDone: null as (() => void) | null,
  cancelOnlineMotion() { this.isPlayingShot = false; },
  syncOnlineBalls() { syncs++; },
  playOnlineShot() { starts++; this.isPlayingShot = true; },
  resumeOnlineShot() { this.isPlayingShot = true; },
  finishOnlineShot() { this.isPlayingShot = false; this.onPlaybackDone?.(); },
  enterBallInHand() {}, standAtCue() {}, presentOffer() {}, notify(title: string) { notices.push(title); },
  startOnlineRound() { rounds++; },
};
const state: PublicState = {
  rules: newPoolRules(), room: "TEST", you: 0, revision: 1, phase: "aim", turn: 0, round: 1,
  game: 1, rematchReady: [false, false], canRematch: false, lastPicks: null,
  names: ["甲", "乙"], scores: [0, 0], pockets: [0, 0], shots: [0, 0],
  mods: [emptyMods(), emptyMods()], curses: [emptyCurses(), emptyCurses()], balls: [], activeShot: null,
  offer: null, needPick: false, winner: null, status: "轮到你",
};
const net = new Online(game as never);
try {
  net.connect("", "甲");
  const socket = Socket.current;
  socket.receive({ t: "state", state });
  assert.ok(game.sim.pocketsLive && game.sim.standardPool, "online entry must restore the rules configuration after the title scene");
  const input = { ax: 1, az: 0, power: 0.5, loft: 0.04 };
  assert.ok(game.onNetShot?.(input));
  game.isPlayingShot = true; // local prediction has already started
  const shot = { id: 1, requestId: 1, shooter: 0, input, step: 0 };
  socket.receive({ t: "shot-start", shot, state: { ...state, revision: 2, phase: "rolling", activeShot: shot } });
  assert.equal(starts, 0, "acknowledgment must not replay the predicted shot");
  assert.equal(syncs, 1, "acknowledgment must not rewind the local cue");
  const end: ServerMsg = { t: "shot-end", shotId: 1, steps: 30, result: { events: [], points: 0, pockets: 0, smashed: 0, scratch: false }, state: { ...state, revision: 3, turn: 1, shots: [1, 0] } };
  socket.receive(end);
  const settledSyncs = syncs, settledNotices = notices.length;
  socket.receive(end);
  socket.receive({ t: "state", state });
  socket.receive({ t: "error", message: "stale", state });
  socket.receive({ t: "shot-start", shot, state: { ...state, revision: 2, phase: "rolling", activeShot: shot } });
  assert.equal(syncs, settledSyncs, "duplicate settlement and stale messages must not restore old state");
  assert.equal(notices.length, settledNotices, "duplicate settlement must not display duplicate points");
  assert.equal(game.onlineState?.revision, 3);
  assert.equal(game.myTurn, false);
  const incoming = { ...emptyCurses(), grip: 2 };
  socket.receive({ t: "state", state: { ...state, revision: 4, turn: 1, curses: [emptyCurses(), incoming] } });
  assert.equal(game.curses.grip, 0, "viewer's received curses are separate from the observed turn");
  assert.equal(game.sim.feltGrip, 3.4, "spectator simulates the cursed opponent's cloth");
  socket.receive({ t: "state", state: { ...state, revision: 5, rules: { ...newPoolRules(), ballInHand: 0 } } });
  assert.equal(game.sim.feltGrip, 1, "clean player must not inherit the observed turn's curse");
  assert.equal(game.onNetShot?.(input), false, "placement is required before another shot");
  assert.ok(game.onNetPlace?.(0, 0));
  assert.deepEqual(socket.sent.at(-1), { t: "place", x: 0, z: 0, revision: 5 });
  socket.receive({ t: "state", state: { ...state, revision: 6 } });
  assert.equal(game.onNetPlace?.(1, 1), false, "free ball cannot be moved after confirmation");
  const over: PublicState = { ...state, revision: 7, phase: "over", winner: 0, canRematch: true };
  socket.receive({ t: "state", state: over });
  assert.ok(game.onNetRematch?.());
  assert.deepEqual(socket.sent.at(-1), { t: "rematch", game: 1 });
  assert.equal(Socket.current, socket, "rematch must keep the same connection");
  assert.ok(game.online); assert.equal(game.screen, "over");
  socket.receive({ t: "state", state: { ...over, revision: 8, rematchReady: [true, false] } });
  assert.equal(game.onNetRematch?.(), false, "a confirmed vote must not be sent repeatedly");
  const previousRounds = rounds;
  const restarted: PublicState = { ...state, game: 2, revision: 9, turn: 1 };
  socket.receive({ t: "state", state: restarted });
  assert.equal(rounds, previousRounds + 1, "new game must clear old local round state");
  assert.ok(game.online); assert.equal(game.screen, "play");
  assert.equal(game.onlineState?.room, "TEST");
  assert.equal(game.onlineState?.game, 2);
  const newSyncs = syncs;
  socket.receive(end); socket.receive({ t: "state", state: over });
  assert.equal(syncs, newSyncs, "late results must not restore the previous game");
  const nextShot = { id: 2, requestId: 1, shooter: 1, input, step: 0 };
  socket.receive({ t: "shot-start", shot: nextShot, state: { ...restarted, revision: 10, phase: "rolling", activeShot: nextShot } });
  assert.equal(starts, 1, "the first shot of a rematch must play normally");
  console.log("PASS same-socket rematch request, waiting, round reset, late-packet rejection and next shot");
  socket.close();
  assert.ok(game.online && !game.myTurn, "disconnect must lock the online match");
  assert.equal(game.onNetRematch, null, "disconnect must disable rematch");
  console.log("PASS client prediction confirmation, duplicate settlement, stale state/error/shot and disconnect lock");
  net.connect("TEST", "甲");
  Socket.current.receive({ t: "state", state });
  game.screen = "upgrade";
  game.offer = ["power"];
  Socket.current.close(ROOM_IDLE_CLOSE_CODE);
  assert.match(game.status, /5 分钟.*释放/);
  assert.ok(game.online && !game.myTurn);
  assert.equal(game.screen, "play", "expiry must dismiss any obsolete choice screen");
  assert.equal(game.offer, null);
  assert.equal(game.onNetShot?.(input), false);
  const expiredSyncs = syncs;
  Socket.current.receive({ t: "state", state: { ...state, revision: 99 } });
  assert.equal(syncs, expiredSyncs, "a closed room cannot be restored by a delayed message");
  assert.match(game.status, /5 分钟.*释放/);
  console.log("PASS idle-room reason, closed-room input lock and stale-message rejection");
} finally { net.disconnect(); }
