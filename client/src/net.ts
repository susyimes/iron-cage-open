import type { Game } from "./game/game.ts";
import { emptyCurses, feltScale, VERSUS_CARDS } from "./game/upgrades.ts";
import { PROTOCOL_VERSION, ROOM_IDLE_CLOSE_CODE, type PublicState, type ServerMsg } from "../../server/src/protocol.ts";
import { targetText } from "./game/rules.ts";

export class Online {
  private socket: WebSocket | null = null;
  private pending: Extract<ServerMsg, { t: "shot-end" }> | null = null;
  private request = 0;
  private awaitingRequest = 0;
  private shotId = 0;
  private completedShotId = 0;
  private pingTimer = 0;
  private connectingTimer = 0;
  private lastMessageAt = 0;
  private lastPicksNotified = "";

  constructor(private readonly game: Game) {}

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.pending = null;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.connectingTimer);
    document.removeEventListener("visibilitychange", this.onVisible);
    this.game.cancelOnlineMotion();
    this.game.online = false;
    this.game.onlineState = null;
    this.game.networkLatency = null;
    this.game.myTurn = true;
    this.game.onNetShot = null;
    this.game.onNetPick = null;
    this.game.onNetPlace = null;
    this.game.onNetRematch = null;
    this.game.placementPending = false;
    this.game.onPlaybackDone = null;
    socket?.close();
  }

  connect(room: string, name: string): void {
    this.disconnect();
    this.game.startOnlineRound();
    this.request = 0;
    this.awaitingRequest = 0;
    this.shotId = 0;
    this.completedShotId = 0;
    this.lastPicksNotified = "";
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(proto + "://" + location.host + "/ws");
    this.socket = socket;
    this.game.online = true;
    this.game.myTurn = false;
    this.game.status = "正在连接房间…";
    const send = (msg: unknown): boolean => {
      if (socket.readyState !== WebSocket.OPEN || this.socket !== socket) return false;
      socket.send(JSON.stringify(msg));
      return true;
    };
    this.game.onNetShot = (shot) => {
      const state = this.game.onlineState;
      if (!state || state.phase !== "aim" || !this.game.myTurn || state.rules.ballInHand !== null) return false;
      this.awaitingRequest = ++this.request;
      return send({ t: "shot", requestId: this.request, revision: state.revision, ...shot });
    };
    this.game.onNetPick = (id) => send({ t: "pick", id, revision: this.game.onlineState?.revision });
    this.game.onNetPlace = (x, z) => {
      const state = this.game.onlineState;
      return !!state && state.phase === "aim" && state.turn === state.you && state.rules.ballInHand === state.you &&
        send({ t: "place", x, z, revision: state.revision });
    };
    this.game.onNetRematch = () => {
      const state = this.game.onlineState;
      return !!state && state.canRematch && state.phase === "over" && !state.rematchReady[state.you] &&
        send({ t: "rematch", game: state.game });
    };
    this.game.onPlaybackDone = () => this.completePending();
    document.addEventListener("visibilitychange", this.onVisible);
    this.connectingTimer = window.setTimeout(() => {
      if (this.socket === socket && !this.game.onlineState) { this.fail("连接超时，请返回主界面重试"); socket.close(); }
    }, 10000);
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.lastMessageAt = performance.now();
      send({ t: "join", version: PROTOCOL_VERSION, room, name });
      const ping = () => {
        if (document.hidden) return;
        if (performance.now() - this.lastMessageAt > 15000) { this.fail("连接中断，请返回主界面重新联机"); socket.close(); return; }
        send({ t: "ping", sent: performance.now() });
      };
      ping();
      this.pingTimer = window.setInterval(ping, 4000);
    });
    socket.addEventListener("message", (ev) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = performance.now();
      try {
        const msg = JSON.parse(String(ev.data)) as ServerMsg;
        if (msg.t === "pong") {
          this.game.networkLatency = Math.max(0, Math.round(performance.now() - msg.sent));
          return;
        }
        if (msg.t === "error") {
          if (msg.state && this.game.onlineState && msg.state.revision < this.game.onlineState.revision) return;
          this.pending = null;
          if (msg.state) this.applyState(msg.state);
          else this.fail(msg.message);
          this.game.notify(msg.message, "请按当前球台重新操作", "bad");
          this.game.status = msg.message;
          this.game.onHud?.();
          return;
        }
        window.clearTimeout(this.connectingTimer);
        const previous = this.game.onlineState;
        if (previous && msg.state.revision < previous.revision) return;
        if (msg.t === "shot-start") {
          if (msg.shot.id <= this.shotId) return;
          if (this.pending) this.completePending();
          this.shotId = msg.shot.id;
          const ownPrediction = msg.shot.shooter === msg.state.you &&
            msg.shot.requestId === this.awaitingRequest && this.game.isPlayingShot;
          this.applyMeta(msg.state);
          if (!ownPrediction) {
            this.game.cancelOnlineMotion();
            this.game.syncOnlineBalls(msg.state.balls);
            this.game.playOnlineShot(msg.shot.input);
          }
          this.game.myTurn = false;
          this.awaitingRequest = 0;
        } else if (msg.t === "shot-end") {
          if (msg.shotId < this.shotId || msg.shotId <= this.completedShotId) return;
          this.shotId = msg.shotId;
          this.pending = msg;
          if (document.hidden || !this.game.isPlayingShot) this.completePending();
          else this.game.finishOnlineShot(msg.steps);
        } else {
          // A peer may finish choosing before this client's last frames have caught up.
          if (this.pending && msg.state.game === this.pending.state.game && msg.state.phase !== "over") this.pending.state = msg.state;
          else { this.pending = null; this.applyState(msg.state); }
        }
      } catch (err) {
        this.fail("同步异常，请返回主界面重新联机");
        console.error("Online message failed", err);
      }
    });
    socket.addEventListener("error", () => { if (this.socket === socket) this.fail("无法连接服务器"); });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.connectingTimer);
      document.removeEventListener("visibilitychange", this.onVisible);
      if (event.code === ROOM_IDLE_CLOSE_CODE) {
        this.game.offer = null;
        this.game.screen = "play";
        this.game.notify("房间已释放", "连续 5 分钟无操作 · 返回主界面可重新进入");
        this.fail("房间已因 5 分钟无操作释放，请返回主界面重新进入");
      } else this.fail("联机已断开，请返回主界面重试");
    });
  }

  private onVisible = (): void => {
    if (document.hidden || this.socket?.readyState !== WebSocket.OPEN) return;
    this.lastMessageAt = performance.now();
    this.socket.send(JSON.stringify({ t: "sync" }));
  };

  private fail(message: string): void {
    this.pending = null;
    this.game.cancelOnlineMotion();
    this.game.input.reset();
    this.game.myTurn = false;
    this.game.onNetRematch = null;
    this.game.phase = "aim";
    this.game.status = message;
    // Stay online and locked: loss of transport must not turn a match into a solo game.
    this.game.onHud?.();
  }

  private completePending(): void {
    const msg = this.pending;
    if (!msg) return;
    this.pending = null;
    this.completedShotId = msg.shotId;
    const shooter = this.game.onlineState?.turn ?? 0;
    const mine = shooter === msg.state.you;
    const result = msg.result;
    this.applyState(msg.state);
    this.game.notify(mine ? "本杆结算" : "对方本杆结算", result.ruling?.summary ?? `${result.pockets} 球进袋`,
      result.ruling?.foul ? "bad" : result.points ? "good" : "info", result.points);
  }

  private applyMeta(state: PublicState): void {
    this.game.online = true;
    this.game.onlineState = state;
    this.game.myTurn = state.phase === "aim" && state.turn === state.you;
    this.game.status = state.status;
    this.game.score = state.scores[state.you] ?? 0;
    this.game.mods = { ...state.mods[state.you]! };
    this.game.curses = { ...(state.curses[state.you] ?? emptyCurses()) };
    this.game.sim.mods = { ...state.mods[state.turn]! };
    this.game.sim.feltGrip = feltScale(state.mods[state.turn]!, state.curses[state.turn]!);
    this.game.sim.pocketsLive = true;
    this.game.sim.standardPool = true;
  }

  private applyState(state: PublicState): void {
    this.game.cancelOnlineMotion();
    this.game.input.reset();
    this.game.placementPending = false;
    if (this.game.onlineState && state.game !== this.game.onlineState.game) {
      this.awaitingRequest = 0;
      this.lastPicksNotified = "";
      this.game.startOnlineRound();
    }
    this.applyMeta(state);
    this.game.syncOnlineBalls(state.balls);
    this.game.offer = null;
    if (state.phase === "rolling" && state.activeShot) {
      this.shotId = state.activeShot.id;
      this.game.resumeOnlineShot(state.activeShot.input, state.activeShot.step);
      this.game.myTurn = false;
    } else if (state.phase === "draft" && state.needPick && state.offer) {
      const offer = state.offer.map((id) => VERSUS_CARDS.find((u) => u.id === id)).filter((u): u is typeof VERSUS_CARDS[number] => !!u);
      this.game.presentOffer(offer);
    } else if (state.phase === "over") {
      this.game.screen = "over";
      this.game.phase = "aim";
      this.game.overTitle = state.winner === state.you ? "你赢了" : "对局结束";
      this.game.overLead = state.status + " · 比分 " + state.scores.join(" : ");
      this.game.history = ["入袋 " + state.pockets.join(" : "), "出杆 " + state.shots.join(" : ")];
    } else {
      this.game.screen = "play";
      this.game.phase = "aim";
      if (this.game.myTurn) {
        if (state.rules.ballInHand === state.you) this.game.enterBallInHand();
        else this.game.standAtCue();
        this.game.notify(state.rules.ballInHand === state.you ? "获得自由球" : "轮到你出杆",
          state.rules.ballInHand === state.you ? "点击球台空位摆放白球，再瞄准击球" : targetText(state.rules, state.you, state.balls.filter(b => !b.pocketed).map(b => b.number)));
      }
    }
    const picks = state.lastPicks;
    if (!picks) {
      this.lastPicksNotified = "";
    } else {
      const key = JSON.stringify(picks);
      if (key !== this.lastPicksNotified) {
        this.lastPicksNotified = key;
        const foeId = picks[1 - state.you];
        const foeCard = foeId ? VERSUS_CARDS.find((u) => u.id === foeId) : null;
        if (foeCard) this.game.notify(`对手抽中「${foeCard.name}」`, foeCard.desc, "info");
        const myId = picks[state.you];
        const myCard = myId ? VERSUS_CARDS.find((u) => u.id === myId) : null;
        if (myCard) this.game.notify(`你抽中「${myCard.name}」`, myCard.desc, "good");
      }
    }
    this.game.onHud?.();
  }
}
