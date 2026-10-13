import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { Match } from "./match.ts";
import { PROTOCOL_VERSION, ROOM_IDLE_CLOSE_CODE, type ClientMsg } from "./protocol.ts";

const ROOM_IDLE_MS = 5 * 60 * 1000;
type Room = { match: Match; lastActionAt: number; sockets: Set<WebSocket> };

/** The injected monotonic clock also lets lifecycle tests cross five minutes without sleeping. */
export function attachRooms(server: Server, now: () => number = () => performance.now()) {
  const rooms = new Map<string, Room>();
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096 });
  const idle = (room: Room) => now() - room.lastActionAt >= ROOM_IDLE_MS;
  const release = (room: Room) => {
    // Remove the entry before closing sockets: late close events must not affect a replacement.
    if (rooms.get(room.match.room) !== room) return;
    rooms.delete(room.match.room);
    for (const socket of room.sockets) socket.close(ROOM_IDLE_CLOSE_CODE, "Room idle for 5 minutes");
    room.sockets.clear();
  };
  function roomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string;
    do {
      code = "";
      for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    } while (rooms.has(code));
    return code;
  }

  let lastTick = now();
  const tick = () => {
    const time = now();
    const dt = (time - lastTick) / 1000;
    lastTick = time;
    for (const room of rooms.values()) {
      if (idle(room)) release(room);
      else room.match.advance(dt);
    }
  };
  const ticker = setInterval(tick, 1000 / 60);
  ticker.unref();
  wss.once("close", () => clearInterval(ticker));

  wss.on("connection", (socket: WebSocket) => {
    socket.on("error", () => socket.terminate());
    let room: Room | null = null;
    let seat = -1;
    socket.on("message", (raw) => {
      if (socket.readyState !== socket.OPEN) return;
      if (room && (rooms.get(room.match.room) !== room || idle(room))) { release(room); return; }
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)) as ClientMsg; } catch { return; }
      if (!msg || typeof msg !== "object") return;
      if (msg.t === "ping" && Number.isFinite(msg.sent)) { socket.send(JSON.stringify({ t: "pong", sent: msg.sent })); return; }
      if (msg.t === "join" && seat < 0) {
        if (msg.version !== PROTOCOL_VERSION) { socket.send(JSON.stringify({ t: "error", message: "游戏已更新，请刷新页面后重新联机" })); return; }
        if (typeof msg.room !== "string" || typeof msg.name !== "string") return;
        const requested = msg.room.trim().toUpperCase();
        if (requested && !/^[A-Z0-9]{4}$/.test(requested)) {
          socket.send(JSON.stringify({ t: "error", message: "房间码需要 4 位英文字母或数字" })); return;
        }
        const code = requested || roomCode();
        const existing = rooms.get(code);
        if (existing && idle(existing)) release(existing);
        const candidate = rooms.get(code) ?? { match: new Match(code), lastActionAt: now(), sockets: new Set<WebSocket>() };
        const joined = candidate.match.join(msg.name || "玩家", (out) => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(out));
        });
        if (joined === null) {
          socket.send(JSON.stringify({ t: "error", message: "房间已满或对局已结束，请换一个房间码" })); return;
        }
        room = candidate;
        seat = joined;
        room.sockets.add(socket);
        room.lastActionAt = now();
        rooms.set(code, room);
        return;
      }
      if (!room || seat < 0) return;
      const match = room.match;
      // Transport traffic and rejected commands never keep an abandoned room alive.
      if (msg.t === "shot" && match.shot(seat, msg)) room.lastActionAt = now();
      if (msg.t === "pick" && match.pick(seat, msg.id, msg.revision)) room.lastActionAt = now();
      if (msg.t === "place" && match.place(seat, msg.x, msg.z, msg.revision)) room.lastActionAt = now();
      if (msg.t === "rematch" && match.rematch(seat, msg.game)) room.lastActionAt = now();
      if (msg.t === "sync") socket.send(JSON.stringify({ t: "state", state: match.stateFor(seat) }));
    });
    socket.on("close", () => {
      if (!room || seat < 0) return;
      room.sockets.delete(socket);
      if (rooms.get(room.match.room) !== room) return;
      room.match.leave(seat);
      if (!room.sockets.size) rooms.delete(room.match.room);
    });
  });
  return { wss, tick };
}
