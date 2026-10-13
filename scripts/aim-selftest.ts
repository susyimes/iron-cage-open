import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Game } from "../client/src/game/game.ts";
import { Input } from "../client/src/input.ts";
import { BALL, SHOT, TABLE } from "../client/src/game/config.ts";
import { Sim, makeBall } from "../client/src/game/physics.ts";
import { newPoolRules } from "../client/src/game/rules.ts";
import type { ShotInput } from "../client/src/game/shot.ts";

// Exercise the real shot/turn methods without constructing a GPU renderer.
function player(loft: number, ax: number, az: number) {
  const sim = new Sim();
  sim.balls.push(makeBall("cue", 0, BALL.radius, BALL.mass, 1, null, 0, TABLE.feltY + BALL.radius, 0));
  return Object.assign(Object.create(Game.prototype), {
    sim, input: new Input(), online: true, myTurn: false, screen: "play", phase: "aim",
    settingsOpen: false, soloRules: newPoolRules(), aimLoft: loft,
    aimDir: new Vector3(ax, 0, az), aimCam: new Vector3(ax, 0, az), camTarget: new Vector3(),
    audio: { shoot() {}, stopCharge() {} }, fx: { burst() {} }, placeCamera() {},
    dist: 6, pitch: 0.7, yawBias: 0,
  });
}

const a = player(0.13, 1, 0), b = player(0.39, 0, -1);
const aShot = { ax: 1, az: 0, power: 0.4, loft: 0.13 };
const bShot = { ax: 0, az: -1, power: 0.6, loft: 0.39 };
for (const [local, remoteShot, ownLoft, ownDirection] of [
  [a, bShot, 0.13, [1, 0, 0]], [b, aShot, 0.39, [0, 0, -1]],
] as const) {
  local.playOnlineShot(remoteShot);
  assert.equal(local.aimLoft, ownLoft, "remote playback must preserve local loft");
  assert.deepEqual(local.aimDir.toArray(), ownDirection, "remote playback must preserve local direction");
  assert.ok(local.sim.balls[0].vel.y > 0, "remote loft must still drive the actual shot physics");
  local.resumeOnlineShot(remoteShot, 12);
  assert.equal(local.aimLoft, ownLoft, "background resync must preserve local loft");
  assert.deepEqual(local.aimDir.toArray(), ownDirection);
  local.phase = "aim";
  local.input.keys.add("KeyW"); local.input.keys.add("KeyQ");
  local.input.mdx = 30; local.input.mdy = -60;
  local.handleInput(0.1);
  assert.equal(local.aimLoft, ownLoft, "spectator input must not edit the next shot");
  assert.deepEqual(local.aimDir.toArray(), ownDirection);
  local.input.reset();
  local.myTurn = true;
  local.standAtCue();
  assert.equal(local.aimLoft, SHOT.loftDefault, "turn entry must restore the default level cue");
  let sent: ShotInput | undefined;
  local.onNetShot = (shot: ShotInput) => { sent = shot; return true; };
  local.power = 0.4;
  local.releaseShot(local.sim.balls[0]);
  assert.equal(sent?.loft, SHOT.loftDefault, "the next outgoing shot must start level");
  assert.equal(sent?.ax, ownDirection[0]); assert.equal(sent?.az, ownDirection[2]);
  local.resetOnlineAim();
  assert.equal(local.aimLoft, SHOT.loftDefault, "a new room starts level");
  local.aimLoft = 0.4;
  local.enterBallInHand();
  assert.equal(local.aimLoft, SHOT.loftDefault, "free-ball turn entry must start level too");
}
console.log("PASS independent aim, remote physics, turn/free-ball default loft, spectator input and outgoing shots");

const charging = player(0.2, 1, 0);
charging.myTurn = true; charging.phase = "charge"; charging.power = 0.8;
charging.input.chargeHeld = true;
charging.openSettings();
assert.equal(charging.phase, "aim", "opening settings must cancel a charged shot");
assert.equal(charging.power, 0); assert.ok(!charging.input.chargeHeld);
charging.input.keys.add("KeyW"); charging.input.keys.add("KeyQ");
charging.handleInput(1);
assert.equal(charging.aimLoft, 0.2, "settings must block shot adjustment");
charging.closeSettings();
assert.equal(charging.screen, "play"); assert.equal(charging.phase, "aim");
assert.equal(charging.input.keys.size, 0, "closing settings must not leave held keys behind");
console.log("PASS settings charge cancellation and input isolation");

let soloStarts = 0, rematches = 0;
const replay = player(0.2, 1, 0);
replay.screen = "over";
replay.startRun = () => { soloStarts++; };
replay.onNetRematch = () => { rematches++; return true; };
assert.equal(replay.playAgain(), true);
assert.equal(rematches, 1); assert.equal(soloStarts, 0);
assert.ok(replay.online, "online replay must never switch to solo");
replay.onNetRematch = null;
assert.equal(replay.playAgain(), false);
assert.equal(soloStarts, 0, "disconnected replay must not fall back to solo");
replay.online = false;
assert.equal(replay.playAgain(), true);
assert.equal(soloStarts, 1, "solo replay remains available");
console.log("PASS replay mode routing and no solo fallback after disconnect");
