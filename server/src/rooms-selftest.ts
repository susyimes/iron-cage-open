import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import { attachRooms } from "./rooms.ts";
import { PROTOCOL_VERSION, ROOM_IDLE_CLOSE_CODE, type ClientMsg, type PublicState, type ServerMsg } from "./protocol.ts";

const server = createServer();
let time = 0;
const { wss, tick } = attachRooms(server, () => time);
const clients: WebSocket[] = [];
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `ws://127.0.0.1:${address.port}/ws`;
const advance = (ms: number) => { time += ms; tick(); };

async function connect() {
  const socket = new WebSocket(url);
  clients.push(socket);
  const queue: ServerMsg[] = [];
  socket.on("message", data => queue.push(JSON.parse(String(data)) as ServerMsg));
  const closed = once(socket, "close");
  await once(socket, "open");
  async function next<T extends ServerMsg["t"]>(type: T, accept: (msg: Extract<ServerMsg, { t: T }>) => boolean = () => true): Promise<Extract<ServerMsg, { t: T }>> {
    const take = () => {
      const i = queue.findIndex(m => m.t === type && accept(m as Extract<ServerMsg, { t: T }>));
      return i >= 0 ? queue.splice(i, 1)[0] as Extract<ServerMsg, { t: T }> : null;
    };
    const queued = take();
    if (queued) return queued;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.off("message", check); reject(new Error(`Timed out waiting for ${type}`)); }, 3000);
      function check() { const msg = take(); if (msg) { clearTimeout(timeout); socket.off("message", check); resolve(msg); } }
      socket.on("message", check);
    });
  }
  const send = (msg: ClientMsg) => socket.send(JSON.stringify(msg));
  async function join(room: string, name = "测试") {
    send({ t: "join", version: PROTOCOL_VERSION, room, name });
    return (await next("state")).state;
  }
  async function sync() {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].t === "state") queue.splice(i, 1);
    send({ t: "sync" });
    return (await next("state")).state;
  }
  return { socket, send, next, join, sync, closed };
}
type Peer = Awaited<ReturnType<typeof connect>>;
async function shoot(peer: Peer, state: PublicState) {
  if (state.rules.ballInHand !== null) {
    const cue = state.balls.find(b => b.kind === "cue")!;
    peer.send({ t: "place", x: cue.x, z: cue.z, revision: state.revision });
    state = (await peer.next("state", m => m.state.revision > state.revision)).state;
  }
  peer.send({ t: "shot", requestId: state.shots[state.you] + 1, revision: state.revision, ax: -1, az: 0.07, power: 0.13, loft: 0.025 });
  const start = await peer.next("shot-start", m => m.shot.shooter === state.you && m.state.revision > state.revision);
  for (let i = 0; i < 1000; i++) advance(1000 / 60);
  return (await peer.next("shot-end", m => m.shotId === start.shot.id)).state;
}

try {
  const waiting = await connect();
  const created = await waiting.join(" ab12 ");
  assert.equal(created.room, "AB12");
  assert.equal(created.phase, "wait");
  advance(299999);
  waiting.send({ t: "ping", sent: 123 });
  assert.equal((await waiting.next("pong")).sent, 123);
  assert.equal((await waiting.sync()).phase, "wait");
  // Keep the old close handshake pending while a replacement room takes the same code.
  waiting.socket.pause();
  advance(1);
  const replacement = await connect();
  assert.equal((await replacement.join("AB12", "新玩家")).you, 0);
  waiting.socket.resume();
  assert.equal((await waiting.closed)[0], ROOM_IDLE_CLOSE_CODE);
  const peer = await connect();
  assert.equal((await peer.join("ab12")).you, 1);
  assert.equal((await replacement.sync()).names[0], "新玩家", "late close must not delete the replacement room");
  assert.equal((await replacement.sync()).phase, "aim");
  console.log("PASS custom-code creation, idle boundary, heartbeat/sync exclusion and room-code reuse with late close");

  advance(299000);
  const third = await connect();
  third.send({ t: "join", version: PROTOCOL_VERSION, room: "AB12", name: "第三人" });
  assert.match((await third.next("error")).message, /已满/);
  // Failed joins and invalid commands must not extend the five-minute deadline.
  peer.send({ t: "shot", requestId: 1, revision: -1, ax: 1, az: 0, power: 0.5, loft: 0 });
  await peer.next("error");
  peer.send({ t: "pick", id: "power", revision: 0 });
  await peer.sync();
  advance(1000);
  assert.equal((await replacement.closed)[0], ROOM_IDLE_CLOSE_CODE);
  assert.equal((await peer.closed)[0], ROOM_IDLE_CLOSE_CODE);
  console.log("PASS both clients released together; rejected joins, shots and picks do not renew activity");

  const a = await connect(), b = await connect();
  await a.join("PLAY");
  advance(290000);
  await b.join("PLAY");
  advance(10001);
  let state = await a.sync();
  assert.equal(state.phase, "aim", "a successful join renews the room");
  advance(280000);
  state = await shoot(a, state);
  assert.equal(state.turn, 1, "an accepted shot renews the room past its old deadline");
  for (let i = 1; i < 6; i++) state = await shoot(i % 2 ? b : a, await (i % 2 ? b : a).sync());
  assert.equal(state.phase, "draft");
  advance(280000);
  const offer = await a.sync();
  assert.ok(offer.offer?.length);
  a.send({ t: "pick", id: offer.offer[0], revision: offer.revision });
  assert.equal((await a.next("state")).state.needPick, false);
  advance(30000);
  assert.equal((await b.sync()).phase, "draft", "valid card selection renews the room");
  // Replaying an already chosen card does not renew activity.
  a.send({ t: "pick", id: offer.offer[0], revision: offer.revision });
  await a.sync();
  advance(270000);
  assert.equal((await a.closed)[0], ROOM_IDLE_CLOSE_CODE);
  assert.equal((await b.closed)[0], ROOM_IDLE_CLOSE_CODE);
  console.log("PASS successful joins, shots and card choices renew activity; duplicate choices do not");

  const empty = await connect();
  const random = await empty.join("");
  assert.match(random.room, /^[A-Z0-9]{4}$/);
  empty.socket.close(); await empty.closed;
  const reuse = await connect();
  assert.equal((await reuse.join(random.room)).you, 0, "empty rooms are released immediately");
  third.send({ t: "join", version: PROTOCOL_VERSION, room: "A!?", name: "测试" });
  assert.match((await third.next("error")).message, /4 位/);
  console.log("PASS random room creation, immediate empty-room cleanup and invalid-code validation");
} finally {
  for (const socket of clients) { socket.resume(); socket.terminate(); }
  for (const socket of wss.clients) socket.terminate();
  await new Promise<void>(resolve => wss.close(() => resolve()));
  await new Promise<void>(resolve => server.close(() => resolve()));
}
