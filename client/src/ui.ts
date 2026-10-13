import type { Game, Hud } from "./game/game.ts";
import { Online } from "./net.ts";
import { VERSUS_CARDS, type UpgradeId } from "./game/upgrades.ts";
import { groupName, groupOf, targetText } from "./game/rules.ts";
import { QUALITY_LEVELS } from "./game/quality.ts";

export class Ui {
  private game: Game | null = null;
  private net: Online | null = null;
  private lastScreen = "";
  private lastQuality = "";
  private lastSettingsOpen = false;
  private settingsOpener: HTMLElement | null = null;
  private readonly title = el("title-screen");
  private readonly hud = el("hud");
  private readonly over = el("over-screen");
  private readonly pause = el("pause-screen");
  private readonly settings = el("settings-screen");
  private readonly upgrades = el("upgrade-screen");
  private readonly cards = el("upgrade-cards");
  private readonly power = el("power-fill");
  private readonly powerWrap = el("power-wrap");
  private readonly wave = el("hud-wave");
  private readonly score = el("hud-score");
  private readonly lives = el("hud-lives");
  private readonly remain = el("hud-remain");
  private readonly combo = el("hud-combo");
  private readonly status = el("hud-status");
  private readonly mods = el("hud-mods");
  private readonly best = el("title-best");
  private readonly overTitle = el("over-title");
  private readonly overLead = el("over-lead");
  private readonly overLog = el("over-log");
  private readonly upgradeEyebrow = el("upgrade-eyebrow");
  private readonly upgradeTitle = el("upgrade-title");
  private readonly upgradeNote = el("upgrade-note");
  private readonly chargeBtn = el("touch-charge");
  private readonly cameraBtn = el("btn-hud-camera");
  private readonly placingTip = el("placing-tip");
  private readonly muteBtns: HTMLElement[];
  private offerSerial = -1;
  private noticeKey = "";
  private modsKey = "";
  private lsTipTimer = 0;
  private wasPortrait = false;

  constructor() {
    this.muteBtns = [...document.querySelectorAll<HTMLElement>("[data-mute]")];
  }

  bind(game: Game, onStart: () => void): void {
    this.game = game;
    const editable = (target: EventTarget | null): boolean => target instanceof HTMLInputElement && !target.disabled && game.screen === "title" && !game.settingsOpen;
    for (const event of ["selectstart", "contextmenu", "copy", "dragstart"]) {
      el("app").addEventListener(event, (e) => { if (!editable(e.target)) e.preventDefault(); });
    }
    el("app").addEventListener("pointerdown", (e) => {
      if (editable(e.target)) return;
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
      window.getSelection()?.removeAllRanges();
    });
    el("btn-start").addEventListener("click", () => {
      void game.audio.unlock();
      game.audio.click();
      this.dropNet();
      onStart();
    });
    for (const id of ["btn-landscape", "btn-float-landscape", "btn-pause-landscape"]) {
      el(id).addEventListener("click", () => {
        void this.preferLandscape();
      });
    }
    this.wasPortrait = document.body.classList.contains("portrait");
    window.addEventListener("resize", () => {
      // main.ts re-classifies body on resize too; check after that handler ran.
      window.setTimeout(() => {
        const portrait = document.body.classList.contains("portrait");
        if (portrait && !this.wasPortrait && this.game?.hud().screen === "play") this.flashLandscapeTip();
        this.wasPortrait = portrait;
      }, 60);
    });
    el("btn-online").addEventListener("click", () => {
      el("online-box").classList.toggle("hidden");
    });
    el("btn-online-go").addEventListener("click", () => {
      void game.audio.unlock();
      const name = (document.getElementById("online-name") as HTMLInputElement | null)?.value.trim() || "玩家";
      const room = (document.getElementById("online-room") as HTMLInputElement | null)?.value.trim() || "";
      el("online-msg").textContent = "正在连接…";
      this.dismissKeyboard();
      this.dropNet();
      this.net = new Online(game);
      this.net.connect(room, name);
    });
    el("btn-again").addEventListener("click", () => {
      void game.audio.unlock();
      game.audio.click();
      game.playAgain();
    });
    for (const id of ["btn-exit", "btn-exit-pause", "btn-exit-over", "btn-exit-upgrade"]) {
      el(id).addEventListener("click", () => {
        game.audio.click();
        this.dropNet();
        game.exitToTitle();
      });
    }
    el("btn-resume").addEventListener("click", () => game.togglePause());
    el("btn-hud-pause").addEventListener("click", () => game.togglePause());
    for (const id of ["btn-settings", "btn-hud-settings", "btn-pause-settings"]) {
      el(id).addEventListener("click", () => {
        this.settingsOpener = el(id);
        this.dismissKeyboard();
        game.openSettings();
      });
    }
    el("btn-settings-back").addEventListener("click", () => game.closeSettings());
    for (const level of QUALITY_LEVELS) {
      el(`quality-${level}`).addEventListener("click", () => game.setQuality(level));
    }
    window.addEventListener("keydown", (e) => {
      if (!game.settingsOpen) return;
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        game.closeSettings();
      } else if (e.key === "Tab") {
        const buttons = [...this.settings.querySelectorAll<HTMLButtonElement>("button")];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first?.focus();
        }
      }
    }, true);
    this.cameraBtn.addEventListener("click", () => game.toggleView());
    this.hold("touch-charge", (down) => {
      game.input.chargeHeld = down;
      if (down) game.input.chargePressed = true;
    });
    this.hold("touch-left", (down) => {
      game.input.nudgeLeft = down;
    });
    this.hold("touch-right", (down) => {
      game.input.nudgeRight = down;
    });
    this.hold("touch-loft-up", (down) => {
      game.input.loftUp = down;
    });
    this.hold("touch-loft-down", (down) => {
      game.input.loftDown = down;
    });
    for (const b of this.muteBtns) {
      b.addEventListener("click", () => {
        game.audio.toggleMute();
        this.paint(game.hud());
      });
    }
    game.audio.onChange = () => this.paint(game.hud());
  }

  paint(h: Hud): void {
    this.showScreen(h.screen, h.settingsOpen);
    if (h.quality !== this.lastQuality) {
      for (const level of QUALITY_LEVELS) el(`quality-${level}`).setAttribute("aria-pressed", String(h.quality === level));
      this.lastQuality = h.quality;
    }
    if (h.settingsOpen && !this.lastSettingsOpen) el(`quality-${h.quality}`).focus();
    if (!h.settingsOpen && this.lastSettingsOpen && this.settingsOpener?.getClientRects().length) this.settingsOpener.focus();
    this.lastSettingsOpen = h.settingsOpen;
    if (h.settingsOpen) {
      const note = h.online ? "联机对局继续进行，请留意出杆回合。" : "单人对局会在设置打开时暂停。";
      const label = el("settings-match-note");
      if (label.textContent !== note) label.textContent = note;
    }
    if (h.screen === "play" && this.lastScreen !== "play" &&
      document.body.classList.contains("touch-ui") && document.body.classList.contains("portrait")) {
      this.flashLandscapeTip();
    }
    this.placingTip.classList.toggle("hidden", !(h.placing && h.myTurn && h.screen === "play"));
    const state = h.network;
    this.hud.classList.toggle("online", h.online);
    this.wave.textContent = state ? `房间 ${state.room} · 第 ${state.round} 杆` : `八球练习 · 抽卡 ${h.draftInto}/3`;
    el("hud-score-label").textContent = h.online ? "你的得分" : "累计得分";
    this.score.textContent = String(h.score).padStart(6, "0");
    this.remain.textContent = `${h.remaining} 球`;
    this.status.textContent = h.status;
    const onlineMsg = document.getElementById("online-msg");
    if (onlineMsg && h.screen === "title" && h.online) onlineMsg.textContent = h.status;
    this.combo.textContent = h.combo > 1 ? `一杆 ${h.combo} 球` : "";
    this.combo.classList.toggle("hidden", h.combo <= 1);
    this.powerWrap.classList.toggle("hidden", !h.charging);
    this.power.style.transform = `scaleX(${h.power})`;
    this.lives.classList.toggle("hidden", h.online);
    this.lives.textContent = groupName(h.rules.groups[0]);
    const foeCurses = state?.curses[1 - state.you];
    const modsKey = JSON.stringify([h.mods, h.curses, foeCurses]);
    if (modsKey !== this.modsKey) {
      this.modsKey = modsKey;
      this.mods.innerHTML = chip("你的加力", h.mods.power) + chip("你的增重", h.mods.mass) + chip("你的磁力", h.mods.magnet) + chip("你的打滑", h.mods.slick) + chip("你受发粘", h.curses.grip, true) + chip("你受轻球", h.curses.light, true) + chip("对手受发粘", foeCurses?.grip ?? 0) + chip("对手受轻球", foeCurses?.light ?? 0);
    }
    el("hud-online").classList.toggle("hidden", !state);
    if (state) {
      for (const [id, index] of [["score-you", state.you], ["score-foe", 1 - state.you]] as const) {
        const panel = el(id);
        panel.querySelector(".player-name")!.textContent = (index === state.you ? "你 · " : "对手 · ") + state.names[index];
        const group = state.rules.groups[index] ?? null;
        const left = group ? state.balls.filter(b => !b.pocketed && groupOf(b.number) === group).length : 7;
        panel.querySelector(".pocket-count")!.innerHTML = group ? left ? `${left}<small>球待进</small>` : `8<small>号决胜</small>` : `—<small>待定花色</small>`;
        panel.querySelector(".player-points")!.textContent = `${groupName(group)} · ${state.scores[index]} 分`;
        (panel.querySelector(".pocket-progress") as HTMLElement).style.transform = `scaleX(${group ? (7 - left) / 7 : 0})`;
        panel.classList.toggle("active", state.turn === index && (state.phase === "aim" || state.phase === "rolling"));
        const pickId = state.lastPicks?.[index] ?? null;
        const pickCard = pickId ? VERSUS_CARDS.find((u) => u.id === pickId) : null;
        panel.querySelector(".last-card")!.textContent = pickCard ? `${index === state.you ? "你" : "对手"}抽中 · ${pickCard.name}` : "";
      }
    }
    el("hud-rule").textContent = h.online
      ? `娱乐八球 · 进球连杆 · 犯规自由球${state ? ` · ${state.turn === state.you ? "你的" : "对手的"}卡牌生效` : ""}${h.latency !== null ? ` · ${h.latency} ms` : ""}`
      : targetText(h.rules, 0, this.game?.sim.live().map(b => b.number) ?? []);
    el("pause-rule").textContent = h.online
      ? "娱乐八球：开球不分花色，之后首次合法进球分全色/花色；进本组球连杆，清完本组后打黑 8，同杆收完本组并打进黑 8 也算获胜。白球落袋、先碰错球、未碰球、碰球后无进球且无碰库均犯规，对手全台自由球。开球需进球或至少四颗彩球碰库；开球黑 8 重置。提前进黑 8 或进黑 8 同时犯规判负。可调抬杆角度跳球，不报袋、不击碎。累计每 6 杆双方抽卡；使坏只影响对手出杆。联机菜单不暂停比赛。"
      : "八球练习：先开球，再以合法进球确定花色，清完本组后打黑 8（最后一颗本组球与黑 8 同杆打进也算获胜）。可调抬杆角度跳球，不报袋、不击碎。普通犯规后白球自动回到开球位置，被占时放到附近空位，其余彩球保留落点；无需摆球即可继续。提前进黑 8 或进黑 8 同时犯规结束本局。每合法进 3 球抽卡。";
    const noticeKey = h.notices.map((n) => n.id).join();
    if (noticeKey !== this.noticeKey) {
      this.noticeKey = noticeKey;
      el("hud-notices").replaceChildren(...h.notices.map((notice) => {
        const node = document.createElement("div"); node.className = `score-notice ${notice.kind}`;
        const title = document.createElement("strong"); title.textContent = notice.title;
        const points = document.createElement("b"); points.textContent = notice.points ? `${notice.points > 0 ? "+" : "−"}${Math.abs(notice.points)}` : "";
        const detail = document.createElement("span"); detail.textContent = notice.detail;
        node.append(title, points, detail); return node;
      }));
    }
    this.best.textContent = h.best > 0 ? `BEST ${h.best}` : "";
    this.overTitle.textContent = h.overTitle;
    this.overLead.textContent = h.overLead;
    if (h.screen === "over") {
      const again = el("btn-again") as HTMLButtonElement;
      const note = el("over-rematch-note");
      const connected = !!this.game?.onNetRematch;
      const ready = state?.rematchReady[state.you] ?? false;
      again.disabled = h.online && (!connected || !state?.canRematch || ready);
      again.textContent = !h.online ? "再来一局" : !connected ? "连接已断开" : !state?.canRematch ? "对手已离开" : ready ? "等待对手…" : state.rematchReady[1 - state.you] ? "接受再来一局" : "再来一局";
      note.classList.toggle("hidden", !h.online);
      note.textContent = !connected ? "连接已断开，请返回主界面重新联机。" : !state?.canRematch ? "对手已离开，请返回主界面重新联机。" : ready ? "你已准备，等待对手确认后在原房间重开。" : state.rematchReady[1 - state.you] ? "对手想再来一局，点击后在原房间重开。" : "双方点击后在原房间重开，下一局轮换开球。";
    }
    this.overLog.textContent = h.history.length ? h.history.join("  ·  ") : "无增强";
    for (const b of this.muteBtns) b.textContent = h.muted ? "静音" : "声音";
    this.chargeBtn.textContent = h.placing && h.myTurn ? "点击台面摆白球" : h.charging ? "松手出杆" : h.canShoot ? "按住蓄力" : "等待";
    this.chargeBtn.classList.toggle("is-off", !h.canShoot);
    (this.chargeBtn as HTMLButtonElement).disabled = !h.canShoot;
    this.cameraBtn.textContent = h.online && !h.myTurn ? "观战" : h.surveying ? "击球位" : "全桌";
    (this.cameraBtn as HTMLButtonElement).disabled = h.placing || (h.online && !h.myTurn);
    this.cameraBtn.setAttribute("aria-pressed", String(h.surveying));
    if (h.screen === "upgrade") {
      const online = this.game?.online ?? false;
      this.upgradeEyebrow.textContent = online ? "BOTH DRAW" : "EVERY 3 BALLS";
      this.upgradeTitle.textContent = online ? "抽一张卡" : "进三球 · 抽一张卡";
      this.upgradeNote.textContent = online
        ? "每累计 6 杆双方选卡。增益只在你出杆时生效，使坏只在对手出杆时生效。每种最多 4 层。点选，或按 1 / 2 / 3。"
        : "每合法打进 3 颗球抽一张。点选，或按 1 / 2 / 3。";
    }
    if (h.screen === "upgrade" && h.offer && h.offerSerial !== this.offerSerial) {
      this.renderCards(h.offer);
      this.offerSerial = h.offerSerial;
    }
    this.lastScreen = h.screen;
  }

  private flashLandscapeTip(): void {
    const body = document.body;
    window.clearTimeout(this.lsTipTimer);
    body.classList.remove("show-ls-tip");
    void body.offsetWidth; // restart the CSS fade animation on retrigger
    body.classList.add("show-ls-tip");
    this.lsTipTimer = window.setTimeout(() => body.classList.remove("show-ls-tip"), 2500);
  }

  private async preferLandscape(): Promise<void> {
    const touch = document.body.classList.contains("touch-ui");
    if (!touch) return;
    const root = document.documentElement;
    try {
      if (!document.fullscreenElement) await root.requestFullscreen();
      const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      await orientation?.lock?.("landscape");
    } catch {
      /* Portrait play stays available when the browser refuses the lock. */
    }
  }

  private dropNet(): void {
    this.net?.disconnect();
    this.net = null;
  }

  private hold(id: string, set: (down: boolean) => void): void {
    const n = el(id);
    const down = (e: PointerEvent) => {
      if ((n as HTMLButtonElement).disabled || !this.game?.hud().canShoot) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      try {
        n.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      set(true);
    };
    const up = (e: PointerEvent) => {
      if (n.hasPointerCapture(e.pointerId)) {
        try {
          n.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      set(false);
    };
    n.addEventListener("pointerdown", down);
    n.addEventListener("pointerup", up);
    n.addEventListener("pointercancel", up);
    n.addEventListener("pointercancel", () => this.game?.input.reset());
    n.addEventListener("lostpointercapture", () => set(false));
  }

  private renderCards(offer: NonNullable<Hud["offer"]>): void {
    this.cards.innerHTML = "";
    offer.forEach((u, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = u.target === "foe" ? "card curse" : "card";
      btn.innerHTML = `<span class="key">${i + 1}</span><img src="${u.icon}" alt="" /><span class="card-copy"><h3>${u.name}</h3><p class="en">${u.nameEn}</p><p>${u.desc}</p></span>`;
      btn.addEventListener("click", () => this.game?.pickUpgrade(u.id as UpgradeId));
      this.cards.append(btn);
    });
  }

  private showScreen(screen: Hud["screen"], settingsOpen: boolean): void {
    if (screen !== "title" && screen !== this.lastScreen) this.dismissKeyboard();
    for (const input of document.querySelectorAll<HTMLInputElement>("#online-box input")) input.disabled = settingsOpen || screen !== "title";
    this.title.classList.toggle("hidden", settingsOpen || screen !== "title");
    this.hud.classList.toggle("hidden", settingsOpen || (screen !== "play" && screen !== "pause"));
    this.over.classList.toggle("hidden", settingsOpen || screen !== "over");
    this.pause.classList.toggle("hidden", settingsOpen || screen !== "pause");
    this.upgrades.classList.toggle("hidden", settingsOpen || screen !== "upgrade");
    this.settings.classList.toggle("hidden", !settingsOpen);
    document.body.classList.toggle("playing", screen === "play" || screen === "pause");
    document.body.classList.toggle("paused", settingsOpen || screen === "pause");
    document.body.classList.toggle("menu", settingsOpen || screen === "title" || screen === "upgrade" || screen === "over");
  }

  private dismissKeyboard(): void {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    this.game?.input.reset();
  }
}

function el(id: string): HTMLElement {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} missing`);
  return n;
}

function chip(label: string, n: number, curse = false): string {
  if (n <= 0) return "";
  return `<span class="chip${curse ? " curse" : ""}">${label} ${n}</span>`;
}
