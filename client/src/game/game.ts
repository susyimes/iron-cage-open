import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AudioBus } from "../audio.ts";
import { Input } from "../input.ts";
import {
  BALL,
  CAM,
  RUN,
  SHOT,
  TABLE,
  ballColor,
  cageBounds,
  EIGHT_BALL_RACK,
  enemyCount,
  enemyHp,
  kitchenX,
  rackApexX,
  triangleRack,
} from "./config.ts";
import { buildArena, updateArenaView, type Arena } from "./arena.ts";
import { tableViewDistance, TABLE_LOOK_Y } from "./camera.ts";
import { Fx } from "./fx.ts";
import { isQualityLevel, loadQuality, QUALITY_PRESETS, QUALITY_STORAGE_KEY, type QualityLevel } from "./quality.ts";
import { impulseCue, makeBall, Sim, type Ball, type Impact } from "./physics.ts";
import { ballTexture, contactShadowTexture, cueWoodTexture } from "./textures.ts";
import { canPlaceCue, collectScore, MAX_SHOT_STEPS, normalizeShot, placeCue, respotBall, respotCue, restoreBall, resultOf, startShot, STEP, stepShot, stopShot, type BallState, type ScoreEvent, type ShotInput } from "./shot.ts";
import { beginTrace, judgeShot, newPoolRules, targetText, traceContacts, type PoolRules, type ShotTrace } from "./rules.ts";
import type { PublicState } from "../../../server/src/protocol.ts";
import {
  applyUpgrade,
  availableCards,
  cueRadiusMul,
  emptyCurses,
  emptyMods,
  isCurse,
  massMul,
  mulberry32,
  offerThree,
  powerMul,
  SOLO_DRAFT_EVERY,
  soloDraftsDue,
  type Curses,
  type Mods,
  type Upgrade,
  type UpgradeId,
} from "./upgrades.ts";

export type Screen = "title" | "play" | "upgrade" | "pause" | "over";

export type Hud = {
  screen: Screen;
  settingsOpen: boolean;
  quality: QualityLevel;
  wave: number;
  lives: number;
  score: number;
  best: number;
  remaining: number;
  combo: number;
  power: number;
  charging: boolean;
  mods: Mods;
  curses: Curses;
  offer: Upgrade[] | null;
  offerSerial: number;
  draftInto: number;
  canShoot: boolean;
  surveying: boolean;
  myTurn: boolean;
  status: string;
  muted: boolean;
  overTitle: string;
  overLead: string;
  history: string[];
  online: boolean;
  network: PublicState | null;
  latency: number | null;
  notices: Notice[];
  rules: PoolRules;
  placing: boolean;
};

export type Notice = { id: number; title: string; detail: string; kind: "good" | "bad" | "info"; points: number; ttl: number };

const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input = new Input();
  readonly audio = new AudioBus();
  readonly sim = new Sim();
  screen: Screen = "title";
  settingsOpen = false;
  private qualityLevel = loadQuality();
  phase: "aim" | "charge" | "rolling" = "aim";
  wave = 1;
  lives = RUN.lives;
  score = 0;
  best = 0;
  combo = 0;
  mods: Mods = emptyMods();
  curses: Curses = emptyCurses();
  offer: Upgrade[] | null = null;
  offerSerial = 0;
  status = "娱乐八球 · 清完本组再打黑 8";
  soloRules = newPoolRules();
  private shotTrace: ShotTrace | null = null;
  placementPending = false;
  overTitle = "";
  overLead = "";
  history: string[] = [];
  power = 0;
  private arena: Arena;
  private fx: Fx;
  private clock = new THREE.Clock();
  private acc = 0;
  private yaw = 0.46;
  private pitch = 0.76;
  private dist = 9.5;
  private yawS = 0.46;
  private pitchS = 0.76;
  private distS = 9.5;
  private yawBias = 0;
  private yawBiasS = 0;
  private survey = false;
  private readonly camTarget = new THREE.Vector3(0, TABLE.feltY, 0);
  private readonly camLook = new THREE.Vector3(0, TABLE.feltY, 0);
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly aimDir = new THREE.Vector3(1, 0, 0);
  private readonly aimCam = new THREE.Vector3(1, 0, 0);
  private aimLoft: number = SHOT.loftDefault;
  private readonly aimHit = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private readonly ray = new THREE.Raycaster();
  private readonly feltPlane = new THREE.Plane(UP, -TABLE.feltY);
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly viewFwd = new THREE.Vector3();
  private stick: THREE.Group;
  private aimLine: THREE.Line;
  private aimRing: THREE.Mesh;
  private ghost: THREE.Mesh;
  private cueHalo: THREE.Mesh;
  private cueGlow: THREE.PointLight;
  private readonly blobGeo = new THREE.CircleGeometry(1, 18);
  private readonly blobMat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    color: 0x050d09,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  private ballGeo = new THREE.SphereGeometry(1, 32, 24);
  private texCache = new Map<number, THREE.CanvasTexture>();
  private runSeed = 1;
  private cleared = 0;
  private draftsTaken = 0;
  private attractKick = 0;
  private baseFov = 46;
  private lastFrame = 0;
  onHud: (() => void) | null = null;
  online = false;
  myTurn = true;
  onNetShot: ((shot: ShotInput) => boolean) | null = null;
  onNetPick: ((id: UpgradeId) => void) | null = null;
  onNetPlace: ((x: number, z: number) => boolean) | null = null;
  onNetRematch: (() => boolean) | null = null;
  onlineState: PublicState | null = null;
  networkLatency: number | null = null;
  private motionActive = false;
  private motionDone = false;
  private shotStep = 0;
  private endStep: number | null = null;
  private shotEvents: ScoreEvent[] = [];
  private notices: Notice[] = [];
  private noticeSerial = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCap()));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(0x171c18);
    this.scene.fog = new THREE.Fog(0x171c18, 26, 60);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.08, 80);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xe4e4d5, 0x3b2b1e, 0.72));
    this.scene.add(new THREE.AmbientLight(0xe3ded3, 0.18));

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(environment, 0.06).texture;
    this.scene.environmentIntensity = 0.52;
    environment.dispose();
    pmrem.dispose();

    this.arena = buildArena(this.scene);
    this.sim.walls = this.arena.walls;
    this.fx = new Fx(this.scene);

    this.stick = this.makeStick();
    this.scene.add(this.stick);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xe7ff3a,
      dashSize: 0.14,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.9,
    });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), lineMat);
    this.scene.add(this.aimLine);
    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.07, 0.1, 22),
      new THREE.MeshBasicMaterial({ color: 0xe7ff3a, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    this.aimRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.aimRing);
    this.ghost = new THREE.Mesh(
      this.ballGeo,
      new THREE.MeshBasicMaterial({ color: 0xe7ff3a, transparent: true, opacity: 0.2, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    this.cueHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.155, 28),
      new THREE.MeshBasicMaterial({ color: 0xe7ff3a, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
    );
    this.cueHalo.rotation.x = -Math.PI / 2;
    this.cueHalo.visible = false;
    this.scene.add(this.cueHalo);
    this.cueGlow = new THREE.PointLight(0xffc070, 0, 2.4, 2);
    this.scene.add(this.cueGlow);

    try {
      this.best = Number(localStorage.getItem(RUN.bestKey) ?? "0") || 0;
    } catch {
      this.best = 0;
    }

    this.input.attach(canvas);
    window.addEventListener("resize", this.onResize);
    window.visualViewport?.addEventListener("resize", this.onResize);
    window.visualViewport?.addEventListener("scroll", this.onResize);
    this.applyQuality();
    this.startAttract();
    this.placeCamera();
    this.clock.start();
    this.renderer.setAnimationLoop(this.loop);
    window.setInterval(() => {
      if (performance.now() - this.lastFrame > 80) this.loop();
    }, 33);
    (window as Window & { __ironCage?: Game }).__ironCage = this;
  }

  hud(): Hud {
    return {
      screen: this.screen,
      settingsOpen: this.settingsOpen,
      quality: this.qualityLevel,
      wave: this.wave,
      lives: this.lives,
      score: this.score,
      best: this.best,
      remaining: this.sim.live().filter((b) => b.kind === "enemy" && !b.sinking).length,
      combo: this.combo,
      power: this.power,
      charging: this.phase === "charge",
      mods: { ...this.mods },
      curses: { ...this.curses },
      offer: this.offer,
      offerSerial: this.offerSerial,
      draftInto: this.draftInto(),
      canShoot: !this.settingsOpen && this.screen === "play" && this.myTurn && !this.placing && (this.phase === "aim" || this.phase === "charge"),
      surveying: this.survey,
      myTurn: this.myTurn,
      status: this.status,
      muted: this.audio.isMuted,
      overTitle: this.overTitle,
      overLead: this.overLead,
      history: this.history.slice(),
      online: this.online,
      network: this.onlineState,
      latency: this.networkLatency,
      notices: this.notices,
      rules: this.onlineState?.rules ?? this.soloRules,
      placing: this.placing,
    };
  }

  startRun(): void {
    this.runSeed = (Math.random() * 0xffffffff) >>> 0;
    this.mods = emptyMods();
    this.curses = emptyCurses();
    this.soloRules = newPoolRules();
    this.placementPending = false;
    this.wave = 1;
    this.lives = RUN.lives;
    this.score = 0;
    this.combo = 0;
    this.history = [];
    this.notices = [];
    this.motionActive = false;
    this.onlineState = null;
    this.networkLatency = null;
    this.acc = 0;
    this.input.reset();
    this.cleared = 0;
    this.draftsTaken = 0;
    this.screen = "play";
    this.offer = null;
    this.status = "八球练习 · 先开球，再以合法进球确定自己的花色";
    this.aimDir.set(1, 0, 0);
    this.aimLoft = SHOT.loftDefault;
    this.aimCam.set(1, 0, 0);
    this.startWave();
  }

  playAgain(): boolean {
    if (this.screen !== "over") return false;
    if (this.online) return this.onNetRematch?.() ?? false;
    this.startRun();
    return true;
  }

  startOnlineRound(): void {
    this.resetOnlineAim();
    this.combo = 0;
    this.history = [];
    this.notices = [];
    this.fx.clear();
  }

  presentOffer(offer: Upgrade[]): void {
    this.offer = offer;
    this.offerSerial += 1;
    this.screen = "upgrade";
    if (!this.motionActive) this.phase = "aim";
  }

  pickUpgrade(id: UpgradeId): void {
    if (this.screen !== "upgrade" || !this.offer?.some((u) => u.id === id)) return;
    if (this.online && this.onNetPick) {
      this.onNetPick(id);
      this.offer = null;
      this.status = "等待对方抽卡";
      this.screen = "play";
      this.onHud?.();
      return;
    }
    if (!isCurse(id)) applyUpgrade(this.mods, id);
    this.sim.applyMods(this.mods, this.curses);
    this.history.push(`${id} x${isCurse(id) ? this.curses[id] : this.mods[id]}`);
    this.audio.uiOk();
    this.offer = null;
    this.draftsTaken += 1;
    this.continueRun("");
  }

  togglePause(): void {
    if (this.phase === "charge") this.cancelCharge();
    this.input.reset();
    if (this.screen === "play") this.screen = "pause";
    else if (this.screen === "pause") this.screen = "play";
    this.onHud?.();
  }

  get quality(): QualityLevel { return this.qualityLevel; }

  openSettings(): void {
    if (this.phase === "charge") this.cancelCharge();
    this.input.reset();
    this.settingsOpen = true;
    this.onHud?.();
  }

  closeSettings(): void {
    this.input.reset();
    this.settingsOpen = false;
    this.onHud?.();
  }

  setQuality(level: QualityLevel): void {
    if (!isQualityLevel(level) || level === this.qualityLevel) return;
    this.qualityLevel = level;
    this.applyQuality();
    try { localStorage.setItem(QUALITY_STORAGE_KEY, level); } catch { /* Keep the choice for this session. */ }
    this.onHud?.();
  }

  private applyQuality(): void {
    const preset = QUALITY_PRESETS[this.qualityLevel];
    const shadows = preset.shadowSize > 0;
    const shadow = this.arena.lamp.shadow;
    const changed = this.renderer.shadowMap.enabled !== shadows;
    // Three.js allocates shadow targets lazily; release the previous size before changing it.
    if (!shadows || shadow.mapSize.x !== preset.shadowSize) {
      shadow.map?.dispose();
      shadow.map = null;
      shadow.mapPass?.dispose();
      shadow.mapPass = null;
    }
    if (shadows) shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    this.renderer.shadowMap.enabled = shadows;
    this.arena.lamp.castShadow = shadows;
    this.renderer.shadowMap.needsUpdate = true;
    shadow.needsUpdate = true;
    if (changed) {
      this.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.needsUpdate = true;
      });
    }
    this.fx.setBudget(preset.particles, preset.particleDensity);
    this.onResize();
  }

  toggleView(): void {
    if (this.screen !== "play" || this.phase === "rolling" || this.placing) return;
    this.survey = !this.survey;
    this.pitch = this.survey ? CAM.surveyPitch : CAM.pitch;
    this.onHud?.();
  }

  /** Abandon the current run and show the title table again. */
  exitToTitle(): void {
    this.cancelOnlineMotion();
    this.power = 0;
    this.offer = null;
    this.online = false;
    this.myTurn = true;
    this.onNetShot = null;
    this.onNetPick = null;
    this.onNetPlace = null;
    this.onNetRematch = null;
    this.onPlaybackDone = null;
    this.mods = emptyMods();
    this.curses = emptyCurses();
    this.onlineState = null;
    this.networkLatency = null;
    this.notices = [];
    this.input.reset();
    this.startAttract();
    this.onHud?.();
  }

  private startAttract(): void {
    this.screen = "title";
    this.mods = emptyMods();
    this.clearBalls();
    this.sim.pocketsLive = false;
    this.sim.mods = emptyMods();
    this.sim.feltGrip = 1;
    this.acc = 0;
    const n = 15;
    const spots = triangleRack(n, BALL.radius, rackApexX());
    for (let i = 0; i < n; i += 1) {
      const s = spots[i];
      if (!s) continue;
      const b = this.spawn("enemy", i + 1, s.x, s.z, 1);
      b.asleep = false;
      b.vel.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
    }
    this.phase = "rolling";
    this.yaw = 0.46;
    this.pitch = 0.76;
    this.dist = 9.5;
    this.yawS = this.yaw;
    this.pitchS = this.pitch;
    this.distS = this.dist;
    this.yawBias = 0;
    this.yawBiasS = 0;
    this.survey = false;
    this.camTarget.set(0, TABLE.feltY, 0);
  }

  private startWave(): void {
    this.clearBalls();
    this.sim.pocketsLive = true;
    this.sim.mods = this.mods;
    const count = enemyCount(this.wave);
    const hp = enemyHp(this.wave);
    const spots = triangleRack(count, BALL.radius, rackApexX());
    for (let i = 0; i < count; i += 1) {
      const s = spots[i];
      if (!s) continue;
      const num = EIGHT_BALL_RACK[i] ?? i + 1;
      this.spawn("enemy", num, s.x, s.z, hp);
    }
    const cueR = BALL.radius * cueRadiusMul(this.mods);
    const cue = this.spawn("cue", 0, kitchenX(), 0, 99);
    cue.radius = cueR;
    cue.mesh?.scale.setScalar(cueR);
    cue.pos.y = TABLE.feltY + cueR;
    this.sim.applyMods(this.mods);
    this.phase = "aim";
    this.power = 0;
    this.combo = 0;
    this.applyShotStance(true);
    this.status = "八球练习 · 开球后首次合法进球确定花色";
    this.onHud?.();
  }

  private spawn(kind: Ball["kind"], number: number, x: number, z: number, hp: number): Ball {
    const map = this.tex(number);
    const mat = new THREE.MeshPhysicalMaterial({
      map,
      roughness: kind === "cue" ? 0.24 : 0.21,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.85,
    });
    const mesh = new THREE.Mesh(this.ballGeo, mat);
    const r = BALL.radius;
    mesh.scale.setScalar(r);
    mesh.position.set(x, TABLE.feltY + r, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const blob = new THREE.Mesh(this.blobGeo, this.blobMat.clone());
    blob.rotation.x = -Math.PI / 2;
    blob.scale.setScalar(r * 0.95);
    this.scene.add(blob);
    mesh.userData.blob = blob;
    const mass = BALL.mass * massMul(this.mods);
    const b = makeBall(kind, number, r, mass, hp, mesh, x, TABLE.feltY + r, z);
    this.sim.balls.push(b);
    return b;
  }

  private tex(n: number): THREE.CanvasTexture {
    let t = this.texCache.get(n);
    if (!t) {
      t = ballTexture(n);
      this.texCache.set(n, t);
    }
    return t;
  }

  private clearBalls(): void {
    this.fx.clear();
    for (const b of this.sim.balls) {
      if (!b.mesh) continue;
      this.scene.remove(b.mesh);
      const blob = b.mesh.userData.blob;
      if (blob instanceof THREE.Mesh) {
        this.scene.remove(blob);
        (blob.material as THREE.Material).dispose();
      }
      const mat = b.mesh.material;
      if (mat instanceof THREE.Material) mat.dispose();
    }
    this.sim.balls = [];
  }

  private cue(): Ball | undefined {
    return this.sim.balls.find((b) => b.kind === "cue" && !b.pocketed && !b.shattered);
  }

  private inLoop = false;
  private loop = (): void => {
    if (this.inLoop) return;
    this.inLoop = true;
    this.lastFrame = performance.now();
    try {
      const dt = Math.min(0.25, this.clock.getDelta());
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.onHud?.();
    } finally {
      this.inLoop = false;
    }
  };

  private update(dt: number): void {
    this.handleInput(dt);
    this.fx.update(dt);
    this.notices = this.notices.filter((n) => (n.ttl -= dt) > 0);
    const paused = this.settingsOpen || this.screen === "pause" || this.screen === "upgrade" || this.screen === "over";
    if ((!paused || this.online) && this.motionActive) {
      this.advanceMotion(dt);
    } else if (this.screen === "title" && !this.online) {
      this.acc += dt;
      const step = STEP;
      const impacts: Impact[] = [];
      while (this.acc >= step) {
        this.sim.step(step, impacts);
        this.acc -= step;
      }
      this.consumeImpacts(impacts);
      this.syncBlobs();
      if (this.screen === "title") {
        this.attractKick += dt;
        if (this.attractKick > 3.2) {
          this.attractKick = 0;
          for (const b of this.sim.live()) {
            b.asleep = false;
            b.vel.x += (Math.random() - 0.5) * 3;
            b.vel.z += (Math.random() - 0.5) * 3;
          }
        }
      }
    }
    this.updateAimVisuals();
    this.placeCamera(dt);
    updateArenaView(this.arena, this.camera, dt);
    this.fx.setView(this.camera, this.renderer.domElement.height);
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    this.input.endFrame();
  }

  private handleInput(dt: number): void {
    const i = this.input;
    if (i.cancelled && this.phase === "charge") this.cancelCharge();
    if (i.pressed.has("KeyM")) this.audio.toggleMute();
    if (this.settingsOpen) {
      if (i.pressed.has("Escape")) this.closeSettings();
      return;
    }
    if (i.pressed.has("Escape")) {
      if (this.phase === "charge") this.cancelCharge();
      else this.togglePause();
    }
    if (this.screen === "upgrade" && this.offer) {
      if (i.pressed.has("Digit1")) this.pickAt(0);
      if (i.pressed.has("Digit2")) this.pickAt(1);
      if (i.pressed.has("Digit3")) this.pickAt(2);
    }
    if (this.screen !== "play" && this.screen !== "title") return;

    if (this.screen === "title") {
      if (i.right || i.touchAim) {
        const yawK = i.touchAim ? 0.004 : 0.0055;
        const pitchK = i.touchAim ? 0.003 : 0.0042;
        this.yaw -= i.mdx * yawK;
        this.pitch = THREE.MathUtils.clamp(this.pitch + i.mdy * pitchK, 0.28, 1.22);
      }
      if (i.keys.has("KeyA") || i.keys.has("ArrowLeft") || i.keys.has("KeyQ")) this.yaw += 1.25 * dt;
      if (i.keys.has("KeyD") || i.keys.has("ArrowRight") || i.keys.has("KeyE")) this.yaw -= 1.25 * dt;
      if (i.keys.has("KeyW") || i.keys.has("ArrowUp")) {
        this.pitch = THREE.MathUtils.clamp(this.pitch + 0.9 * dt, 0.28, 1.22);
      }
      if (i.keys.has("KeyS") || i.keys.has("ArrowDown")) {
        this.pitch = THREE.MathUtils.clamp(this.pitch - 0.9 * dt, 0.28, 1.22);
      }
      this.dist = THREE.MathUtils.clamp(this.dist * (1 + i.wheel * 0.0012), 5.2, 16);
      if (i.pressed.has("KeyR")) {
        this.yaw = 0.46;
        this.pitch = 0.76;
        this.dist = 9.5;
      }
      return;
    }

    if (this.phase === "rolling") return;
    if (this.placing) {
      if (this.myTurn && !this.placementPending && i.placePressed) {
        this.ndc.set(i.mx, i.my);
        this.ray.setFromCamera(this.ndc, this.camera);
        if (this.ray.ray.intersectPlane(this.feltPlane, this.tmp)) this.requestCuePlacement(this.tmp.x, this.tmp.z);
      }
      return;
    }

    if (i.right) {
      const orbit = i.touchAim ? 0.0032 : 0.0014;
      const pitchK = i.touchAim ? 0.0024 : 0.0011;
      this.yawBias -= i.mdx * orbit;
      this.pitch = THREE.MathUtils.clamp(this.pitch + i.mdy * pitchK, CAM.pitchMin, CAM.pitchMax);
    }
    this.dist = THREE.MathUtils.clamp(this.dist * (1 + i.wheel * 0.0012), CAM.distMin, CAM.distMax);
    if (i.pressed.has("KeyR")) {
      this.yawBias = 0;
      this.survey = false;
      this.pitch = CAM.pitch;
      this.dist = CAM.dist;
    }
    if (i.pressed.has("KeyV")) this.toggleView();

    // Spectating must not edit the local player's next shot.
    if (!this.myTurn) return;
    const cue = this.cue();
    if (!cue) return;

    if (this.phase === "aim" || this.phase === "charge") {
      let turn = 0;
      if (i.keys.has("KeyQ") || i.keys.has("KeyA") || i.keys.has("ArrowLeft")) turn += 1;
      if (i.keys.has("KeyE") || i.keys.has("KeyD") || i.keys.has("ArrowRight")) turn -= 1;
      if (turn !== 0) this.rotateAim(turn * 0.2 * dt);
      if (i.nudge !== 0 && this.phase === "aim") this.rotateAim(i.nudge * 0.7 * dt);
      if (this.phase === "aim") this.steerAim(dt, i.right);
      if (this.phase === "aim" && this.myTurn && (i.leftPressed || i.chargePressed || i.pressed.has("Space"))) this.beginCharge();
      if (this.phase === "charge") {
        const holding = i.left || i.chargeHeld || i.keys.has("Space");
        this.power = Math.min(1, this.power + dt / SHOT.chargeTime);
        this.audio.setCharge(this.power);
        if (!holding) this.releaseShot(cue);
      }
    }
  }

  private pickAt(index: number): void {
    const u = this.offer?.[index];
    if (u) this.pickUpgrade(u.id);
  }

  private steerAim(dt: number, mouseLocked: boolean): void {
    const i = this.input;
    let loft = 0;
    if (i.keys.has("KeyW") || i.keys.has("ArrowUp")) loft += 0.22;
    if (i.keys.has("KeyS") || i.keys.has("ArrowDown")) loft -= 0.22;
    if (i.loftUp) loft += 0.32;
    if (i.loftDown) loft -= 0.32;
    this.aimLoft += loft * dt;
    if (!mouseLocked) {
      const yawK = i.touchAim ? 0.0018 : 0.00038;
      const loftK = i.touchAim ? 0.0013 : 0.00028;
      if (Math.abs(i.mdx) > 0.2) this.rotateAim(-i.mdx * yawK);
      if (Math.abs(i.mdy) > 0.2) this.aimLoft -= i.mdy * loftK;
    }
    this.aimLoft = THREE.MathUtils.clamp(this.aimLoft, SHOT.loftMin, SHOT.loftMax);
    const cue = this.cue();
    if (cue) {
      this.aimHit.copy(cue.pos).addScaledVector(this.aimDir, 1.2);
      this.aimHit.y = TABLE.feltY;
    }
  }

  private beginCharge(): void {
    if (this.placing || !this.myTurn) return;
    this.phase = "charge";
    this.power = 0;
    void this.audio.unlock();
    this.audio.startCharge();
  }

  private cancelCharge(): void {
    this.phase = "aim";
    this.power = 0;
    this.audio.stopCharge();
  }

  private releaseShot(_cue: Ball): void {
    if (this.placing || !this.myTurn) { this.cancelCharge(); return; }
    this.audio.stopCharge();
    const shift = this.input.keys.has("ShiftLeft") || this.input.keys.has("ShiftRight");
    const shot = normalizeShot({
      ax: this.aimDir.x, az: this.aimDir.z, power: this.power,
      loft: this.aimLoft + (shift ? SHOT.loftBoost : 0),
    });
    if (!shot) { this.cancelCharge(); return; }
    if (this.online && (!this.onNetShot || !this.onNetShot(shot))) { this.cancelCharge(); return; }
    this.beginMotion(shot);
    if (this.online) this.myTurn = false;
  }

  standAtCue(): void { this.applyShotStance(true); }

  resetOnlineAim(): void {
    this.aimDir.set(1, 0, 0);
    this.aimCam.copy(this.aimDir);
    this.aimLoft = SHOT.loftDefault;
  }

  get placing(): boolean { return (this.onlineState?.rules ?? this.soloRules).ballInHand !== null; }

  enterBallInHand(): void {
    this.aimLoft = SHOT.loftDefault;
    this.phase = "aim";
    this.survey = true;
    this.pitch = CAM.surveyPitch;
    this.dist = CAM.overviewDist;
    this.placementPending = false;
  }

  requestCuePlacement(x: number, z: number): boolean {
    if (!this.placing || !this.myTurn || this.placementPending || this.screen !== "play" || this.phase !== "aim") return false;
    if (!canPlaceCue(this.sim, x, z)) { this.notify("这里不能摆白球", "请选择台内空位，避开彩球和袋口", "bad"); return false; }
    if (this.online) {
      this.placementPending = this.onNetPlace?.(x, z) ?? false;
      return this.placementPending;
    }
    placeCue(this.sim, x, z);
    this.soloRules.ballInHand = null;
    this.input.reset();
    this.syncBlobs();
    this.standAtCue();
    this.status = targetText(this.soloRules, 0, this.sim.live().map(b => b.number));
    return true;
  }

  get isPlayingShot(): boolean { return this.motionActive; }

  notify(title: string, detail = "", kind: Notice["kind"] = "info", points = 0): void {
    this.notices.push({ id: ++this.noticeSerial, title, detail, kind, points, ttl: 4.5 });
    this.notices = this.notices.slice(-3);
  }

  cancelOnlineMotion(): void {
    this.motionActive = false;
    this.endStep = null;
    this.acc = 0;
    this.power = 0;
    this.audio.stopCharge();
  }

  /** A confirmed remote shot starts from the server's pre-impulse snapshot. */
  playOnlineShot(input: ShotInput): void {
    this.beginMotion(input);
    this.myTurn = false;
  }

  /** Explicit resync after returning from background; this snapshot is already moving. */
  resumeOnlineShot(input: ShotInput, step: number): void {
    this.prepareMotion(input);
    this.shotStep = step;
    this.motionDone = step >= MAX_SHOT_STEPS;
  }

  finishOnlineShot(steps: number): void {
    this.endStep = steps;
    if (!this.motionActive || this.shotStep >= steps || this.motionDone) {
      this.motionActive = false;
      this.onPlaybackDone?.();
    }
  }

  onPlaybackDone: (() => void) | null = null;

  syncOnlineBalls(snaps: BallState[]): void {
    // The title scene disables pockets. Every online restore must restore play configuration too.
    this.sim.pocketsLive = true;
    this.sim.standardPool = true;
    const old = new Map(this.sim.balls.map(b => [b.id, b]));
    const ids = new Set(snaps.map((s) => s.id));
    for (const b of [...this.sim.balls]) if (!ids.has(b.id)) this.removeBall(b);
    const ordered: Ball[] = [];
    for (const state of snaps) {
      let ball = old.get(state.id);
      if (ball && (ball.kind !== state.kind || ball.number !== state.number)) { this.removeBall(ball); ball = undefined; }
      if (!ball) ball = this.spawn(state.kind, state.number, state.x, state.z, state.maxHp);
      restoreBall(ball, state);
      ordered.push(ball);
    }
    // Pair iteration order is part of deterministic physics, including reused title meshes.
    this.sim.balls = ordered;
    this.sim.refreshVisuals();
    this.syncBlobs();
  }

  private prepareMotion(input: ShotInput): void {
    this.notices = [];
    // The received shot drives physics and the overview camera, not local aim.
    this.screen = "play";
    this.phase = "rolling";
    this.motionActive = true;
    this.motionDone = false;
    this.shotStep = 0;
    this.endStep = null;
    this.shotEvents = [];
    this.shotTrace = beginTrace(this.sim);
    this.acc = 0;
    this.combo = 0;
    this.power = 0;
    this.yaw = Math.atan2(-input.ax, -input.az);
    this.pitch = CAM.overviewPitch;
    this.dist = CAM.overviewDist;
    this.status = this.online ? "击球中" : "球在滚动";
  }

  private beginMotion(input: ShotInput): void {
    this.prepareMotion(input);
    startShot(this.sim, input, this.sim.mods);
    const cue = this.cue();
    this.audio.shoot(input.power);
    if (cue) this.fx.burst(cue.pos.x, cue.pos.y, cue.pos.z, 0xffe7a0, 8, 2);
  }

  private advanceMotion(dt: number): void {
    if (this.motionDone) return;
    this.acc += dt;
    // Catch up a delayed/hidden client in bounded batches when settlement arrives.
    if (this.endStep !== null && this.endStep - this.shotStep > 8) this.acc = Math.max(this.acc, STEP * 8);
    let budget = 16;
    const impacts: Impact[] = [];
    while (this.acc + 1e-9 >= STEP && budget-- > 0 && !this.motionDone) {
      this.acc -= STEP;
      this.shotStep++;
      const stepImpacts: Impact[] = [];
      this.motionDone = stepShot(this.sim, this.shotStep, stepImpacts);
      if (this.shotTrace) traceContacts(this.shotTrace, stepImpacts);
      impacts.push(...stepImpacts);
      for (const event of collectScore(this.sim)) this.onScore(event);
      if (this.endStep !== null && this.shotStep >= this.endStep) this.motionDone = true;
    }
    this.consumeImpacts(impacts);
    this.syncBlobs();
    if (!this.motionDone) return;
    if (!this.online) { this.motionActive = false; this.settle(); }
    else if (this.endStep !== null) { this.motionActive = false; this.onPlaybackDone?.(); }
    else this.status = "球已停稳 · 等待结算";
  }

  private onScore(event: ScoreEvent): void {
    this.shotEvents.push(event);
    this.combo++;
    const who = this.online && this.onlineState?.turn !== this.onlineState?.you ? "对方 · " : "";
    this.notify(who + event.number + " 号" + (event.kind === "pocket" ? "进袋" : "击碎"),
      "停球后按花色与犯规情况结算", "good");
  }

  private removeBall(ball: Ball): void {
    if (ball.mesh) {
      const blob = ball.mesh.userData.blob;
      if (blob instanceof THREE.Mesh) {
        this.scene.remove(blob);
        (blob.material as THREE.Material).dispose();
      }
      this.scene.remove(ball.mesh);
      const mat = ball.mesh.material;
      if (mat instanceof THREE.Material) mat.dispose();
    }
    this.sim.balls = this.sim.balls.filter((b) => b !== ball);
  }

  private settle(): void {
    this.yawBias = 0;
    this.yawBiasS = 0;
    stopShot(this.sim);
    const result = resultOf(this.shotEvents, this.sim);
    const ruling = judgeShot(this.soloRules, 0, this.shotTrace ?? beginTrace(this.sim), result);
    this.score += ruling.points;
    this.cleared += ruling.points / 100;
    if (ruling.respotEight) respotBall(this.sim, this.sim.balls.find(b => b.number === 8)!, rackApexX());
    if (result.scratch) this.audio.scratch();
    // Practice resumes from the starting spot after any foul; keep object balls
    // where they settled and use the nearest free spot if the start is occupied.
    if (result.scratch || (ruling.foul && ruling.winner === null)) respotCue(this.sim);
    this.soloRules.ballInHand = null;
    const note = ruling.summary.replace("对手自由球", "白球已回到开球位置").replace("交换球权", "继续练习");
    ruling.summary = note;
    this.notify(ruling.foul ? "本杆犯规" : "本杆结算", note, ruling.foul ? "bad" : ruling.points ? "good" : "info", ruling.points);
    this.rememberBest();
    this.combo = 0;
    if (ruling.winner !== null) { this.finish(ruling.winner === 0 ? "清台成功" : "本局结束", ruling.summary); return; }
    this.continueRun(note);
  }

  private draftInto(): number {
    if (soloDraftsDue(this.cleared, this.draftsTaken) > 0) return SOLO_DRAFT_EVERY;
    return this.cleared % SOLO_DRAFT_EVERY;
  }

  private openDraft(): void {
    const rng = mulberry32(this.runSeed + (this.draftsTaken + 1) * 917 + this.cleared * 13);
    this.presentOffer(offerThree(rng, availableCards(this.mods)));
    this.audio.uiOk();
    this.status = `已合法打进 ${this.cleared} 颗球 · 抽一张卡`;
    this.onHud?.();
  }

  private continueRun(note: string): void {
    if (!this.online && soloDraftsDue(this.cleared, this.draftsTaken) > 0) {
      if (availableCards(this.mods).length) { this.openDraft(); return; }
      this.draftsTaken = Math.floor(this.cleared / SOLO_DRAFT_EVERY);
    }
    this.screen = "play";
    this.phase = "aim";
    if (this.placing) {
      this.enterBallInHand();
      this.status = "自由球 · 点击球台空位摆放白球";
    } else {
      this.applyShotStance(true);
      const target = targetText(this.soloRules, 0, this.sim.live().map(b => b.number));
      this.status = note ? `${note} · ${target}` : target;
    }
    this.onHud?.();
  }

  private rememberBest(): void {
    if (this.online || this.score <= this.best) return;
    this.best = this.score;
    try { localStorage.setItem(RUN.bestKey, String(this.best)); } catch { /* storage unavailable */ }
  }

  private finish(title: string, lead: string): void {
    this.screen = "over";
    this.overTitle = title;
    this.overLead = lead + " · 分数 " + this.score;
    this.rememberBest();
    this.onHud?.();
  }

  private consumeImpacts(impacts: Impact[]): void {
    for (const hit of impacts) {
      if (hit.kind === "cage") {
        this.fx.sparks(hit.x, hit.y, hit.z, hit.speed);
        this.audio.impact("cage", hit.speed);
      } else if (hit.kind === "cushion") {
        this.fx.burst(hit.x, hit.y, hit.z, 0xc4a574, 6, 1.4);
        this.audio.impact("cushion", hit.speed);
      } else if (hit.kind === "ball") {
        this.audio.impact("ball", hit.speed);
        if (hit.speed > 2.4) this.fx.impact(hit.x, hit.y, hit.z, hit.speed);

      } else if (hit.kind === "smash") {
        const col = hit.a ? ballColor(hit.a.number) : 0xffaa66;
        this.fx.smash(hit.x, hit.y, hit.z, col);
        this.audio.shatter();

      } else if (hit.kind === "pocket") {
        this.fx.pocket(hit.x, hit.y, hit.z);
        if (hit.a?.kind === "cue") this.audio.scratch();
        else this.audio.pocket();
      } else if (hit.kind === "felt") {
        this.audio.impact("felt", hit.speed);
      }
    }
  }

  private updateAimVisuals(): void {
    const aiming = this.screen === "play" && this.myTurn && !this.placing && (this.phase === "aim" || this.phase === "charge");
    const cue = this.cue();
    this.stick.visible = aiming && !!cue;
    this.aimLine.visible = aiming && !!cue;
    this.aimRing.visible = aiming && !!cue;
    this.ghost.visible = aiming && !!cue;
    this.cueHalo.visible = aiming && !!cue;
    this.cueGlow.intensity = this.phase === "charge" ? 1.8 + this.power * 3.5 : 0;
    if (!cue || !aiming) return;
    const dir = this.aimDir;
    const pull = 0.06 + (this.phase === "charge" ? this.power * 0.42 : 0);
    // Tip rests on the shot line, just behind the ball. Local +Y runs back along that line.
    this.tmp.copy(cue.pos).addScaledVector(dir, -(cue.radius + 0.02 + pull));
    this.tmp.y = cue.pos.y;
    this.viewFwd.copy(dir).negate();
    this.viewFwd.y = Math.max(0.065, this.aimLoft);
    this.viewFwd.normalize();
    this.stick.quaternion.setFromUnitVectors(this.fwd.set(0, 1, 0), this.viewFwd);
    this.stick.position.copy(this.tmp);
    this.cueGlow.position.copy(cue.pos);
    this.cueHalo.position.set(cue.pos.x, TABLE.feltY + 0.008, cue.pos.z);
    this.cueHalo.scale.setScalar(cue.radius / BALL.radius);
    const haloMat = this.cueHalo.material;
    if (haloMat instanceof THREE.MeshBasicMaterial) {
      haloMat.color.set(this.phase === "charge" ? 0xff5a2a : 0xe7ff3a);
      haloMat.opacity = 0.45 + this.power * 0.5;
    }
    const ringOk = this.aimHit.distanceTo(cue.pos) > 0.4;
    this.aimRing.visible = aiming && ringOk;
    this.aimRing.position.set(this.aimHit.x, TABLE.feltY + 0.01, this.aimHit.z);
    const end = this.predictEnd(cue);
    const from = cue.pos.clone().addScaledVector(dir, cue.radius + 0.05);
    from.y = TABLE.feltY + 0.014 + this.aimLoft * 0.12;
    end.y = TABLE.feltY + 0.014 + this.aimLoft * 0.55;
    const geo = this.aimLine.geometry;
    geo.setFromPoints([from, end]);
    this.aimLine.computeLineDistances();
    const mat = this.aimLine.material;
    if (mat instanceof THREE.LineDashedMaterial) {
      mat.color.set(this.phase === "charge" ? 0xff5a2a : 0xe7ff3a);
    }
    this.ghost.position.set(end.x, TABLE.feltY + cue.radius, end.z);
    this.ghost.scale.setScalar(cue.radius * 0.92);
    const ghostMat = this.ghost.material;
    if (ghostMat instanceof THREE.MeshBasicMaterial) ghostMat.opacity = 0.22;
  }

  private syncBlobs(): void {
    for (const b of this.sim.balls) {
      const blob = b.mesh?.userData.blob;
      if (!(blob instanceof THREE.Mesh)) continue;
      const height = Math.max(0, b.pos.y - TABLE.feltY - b.radius);
      blob.visible = !b.pocketed && !b.shattered && !b.sinking && height < 2.2;
      if (!blob.visible) continue;
      blob.position.set(b.pos.x, TABLE.feltY + 0.004, b.pos.z);
      blob.scale.setScalar(b.radius * (1.5 + height * 0.75));
      (blob.material as THREE.MeshBasicMaterial).opacity = 0.65 / (1 + height * 3);
    }
  }

  private predictEnd(cue: Ball): THREE.Vector3 {
    const p = cue.pos.clone();
    const d = this.aimDir.clone();
    d.y = 0;
    d.normalize();
    for (let i = 0; i < 80; i += 1) {
      p.addScaledVector(d, 0.08);
      for (const o of this.sim.live()) {
        if (o === cue) continue;
        if (p.distanceTo(o.pos) < cue.radius + o.radius) return p;
      }
      if (Math.abs(p.x) > TABLE.length / 2 - cue.radius) return p;
      if (Math.abs(p.z) > TABLE.width / 2 - cue.radius) return p;
    }
    return p;
  }

  private rotateAim(angle: number): void {
    this.aimDir.applyAxisAngle(UP, angle);
    this.aimDir.y = 0;
    if (this.aimDir.lengthSq() < 1e-8) this.aimDir.set(1, 0, 0);
    else this.aimDir.normalize();
  }

  private applyShotStance(full: boolean): void {
    this.yawBias = 0;
    this.yawBiasS = 0;
    if (full) {
      this.survey = false;
      this.pitch = CAM.pitch;
      this.pitchS = CAM.pitch;
      this.dist = CAM.dist;
      this.distS = CAM.dist;
      this.aimLoft = SHOT.loftDefault;
    }
    const cue = this.sim.balls.find((b) => b.kind === "cue");
    if (cue) this.camTarget.set(cue.pos.x, TABLE.feltY + cue.radius, cue.pos.z);
    this.aimCam.copy(this.aimDir);
    this.placeCamera(1 / 60);
  }

  private placeShotCamera(origin: THREE.Vector3, dist: number, pitch: number, yawBias: number): void {
    this.fwd.copy(this.aimCam);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-8) this.fwd.set(1, 0, 0);
    else this.fwd.normalize();
    this.viewFwd.copy(this.fwd).applyAxisAngle(UP, yawBias);
    const d = this.camera.aspect < 0.75 ? dist * CAM.portraitMul : dist;
    // The camera may sit outside the cage; near-side steel fades in updateArenaView.
    // Clamping it inside the rail used to make the cue fill the entire foreground.
    const back = d * Math.cos(pitch);
    const narrow = this.camera.aspect < 0.85;
    const height = CAM.lift + d * Math.sin(pitch);
    const side = narrow ? 0 : 0.12;
    this.desiredPos.set(
      origin.x - this.viewFwd.x * back + -this.viewFwd.z * side,
      TABLE.feltY + height,
      origin.z - this.viewFwd.z * back + this.viewFwd.x * side,
    );
    this.desiredLook.copy(origin).addScaledVector(this.viewFwd, narrow ? 1.15 : CAM.lookAhead);
    this.desiredLook.y = TABLE.feltY + 0.06;
    this.desiredLook.x = THREE.MathUtils.clamp(this.desiredLook.x, -TABLE.length / 2 + 0.2, TABLE.length / 2 - 0.2);
    this.desiredLook.z = THREE.MathUtils.clamp(this.desiredLook.z, -TABLE.width / 2 + 0.2, TABLE.width / 2 - 0.2);
  }

  private placeOverviewCamera(dist: number, pitch: number, yaw: number): void {
    this.camTarget.set(0, TABLE_LOOK_Y, 0);
    // Use the long side of landscape screens; keep the table upright on phones.
    if (this.screen !== "title") yaw += CAM.overviewYaw * THREE.MathUtils.clamp((this.camera.aspect - 0.7) / 0.9, 0, 1);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const d = Math.max(dist, tableViewDistance(this.camera.aspect, this.baseFov, yaw, pitch));
    this.desiredPos.set(
      this.camTarget.x + d * Math.sin(yaw) * cp,
      this.camTarget.y + d * sp,
      this.camTarget.z + d * Math.cos(yaw) * cp,
    );
    this.desiredLook.copy(this.camTarget);
  }

  private placeCamera(dt = 1 / 60, snap = false): void {
    const overview = this.screen === "title" || this.phase === "rolling" || this.screen === "upgrade" || this.survey || (this.online && !this.myTurn);
    const kOrbit = snap ? 1 : 1 - Math.exp(-7 * dt);
    const kAim = snap ? 1 : 1 - Math.exp(-7 * dt);
    const kFollow = snap ? 1 : 1 - Math.exp(-6 * dt);
    const kBlend = snap ? 1 : 1 - Math.exp((overview ? -5 : -7) * dt);
    this.yawS += (this.yaw - this.yawS) * kOrbit;
    this.pitchS += (this.pitch - this.pitchS) * kOrbit;
    this.distS += (this.dist - this.distS) * kOrbit;
    this.yawBiasS += (this.yawBias - this.yawBiasS) * kOrbit;
    if (snap) this.aimCam.copy(this.aimDir);
    else {
      this.aimCam.lerp(this.aimDir, kAim);
      this.aimCam.y = 0;
      if (this.aimCam.lengthSq() < 1e-8) this.aimCam.set(1, 0, 0);
      else this.aimCam.normalize();
    }
    const follow = this.screen === "play" && !overview ? this.sim.balls.find((b) => b.kind === "cue") : undefined;
    if (!follow) {
      const surveying = this.survey && this.phase !== "rolling" && this.screen === "play";
      this.placeOverviewCamera(
        surveying ? CAM.overviewDist : this.distS,
        surveying ? CAM.surveyPitch : this.pitchS,
        surveying ? Math.atan2(-this.aimCam.x, -this.aimCam.z) : this.yawS,
      );
    } else {
      this.camTarget.x += (follow.pos.x - this.camTarget.x) * kFollow;
      this.camTarget.y = TABLE.feltY + follow.radius;
      this.camTarget.z += (follow.pos.z - this.camTarget.z) * kFollow;
      this.placeShotCamera(this.camTarget, this.distS, this.pitchS, this.yawBiasS);
    }
    if (snap) {
      this.camera.position.copy(this.desiredPos);
      this.camLook.copy(this.desiredLook);
    } else {
      this.camera.position.lerp(this.desiredPos, kBlend);
      this.camLook.lerp(this.desiredLook, kBlend);
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
  }

  private makeStick(): THREE.Group {
    // Model in world units. Foreshortening comes from the camera, never from scaling.
    const group = new THREE.Group();
    group.name = "full-length-cue";
    const shaft = new THREE.MeshStandardMaterial({ map: cueWoodTexture(false), color: 0xffedcb, roughness: 0.38 });
    const butt = new THREE.MeshStandardMaterial({ map: cueWoodTexture(true), color: 0xa66e43, roughness: 0.3 });
    const ivory = new THREE.MeshStandardMaterial({ color: 0xf0e8cd, roughness: 0.3 });
    const chalk = new THREE.MeshStandardMaterial({ color: 0x507f8b, roughness: 0.9 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x231b17, roughness: 0.8 });
    const ghostMaterial = new THREE.MeshBasicMaterial({
      color: 0xd8c5a0, transparent: true, opacity: 0.2,
      depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
    });
    const part = (from: number, length: number, near: number, far: number, material: THREE.Material) => {
      const geo = new THREE.CylinderGeometry(far, near, length, 20);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.y = from + length / 2;
      mesh.castShadow = true;
      group.add(mesh);
      // A faint full-size silhouette remains readable through the near rail/cage.
      const occluded = new THREE.Mesh(geo, ghostMaterial);
      occluded.position.copy(mesh.position);
      occluded.renderOrder = 6;
      group.add(occluded);
    };
    part(0, 0.025, 0.022, 0.022, chalk);
    part(0.025, 0.095, 0.022, 0.023, ivory);
    part(0.12, 2.08, 0.023, 0.042, shaft);
    part(2.20, 0.07, 0.042, 0.044, ivory);
    part(2.27, 0.56, 0.044, 0.05, butt);
    part(2.83, 0.65, 0.05, 0.055, grip);
    part(3.48, 0.32, 0.055, 0.058, butt);
    group.visible = false;
    return group;
  }

  private pixelCap(): number {
    const preset = QUALITY_PRESETS[this.qualityLevel];
    return window.matchMedia("(pointer: coarse)").matches ? preset.touchPixelRatio : preset.desktopPixelRatio;
  }

  private onResize = (): void => {
    const vv = window.visualViewport;
    const w = Math.max(1, vv?.width ?? window.innerWidth);
    const h = Math.max(1, vv?.height ?? window.innerHeight);
    this.camera.aspect = w / h;
    this.baseFov = 46 + THREE.MathUtils.clamp((0.95 - w / h) / 0.45, 0, 1) * 14;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelCap()));
    this.renderer.setSize(w, h);
  };

  selfTest(): string[] {
    const logs: string[] = [];
    const cue = this.cue() ?? this.sim.balls.find((b) => b.kind === "cue") ?? this.sim.live()[0];
    if (cue) {
      const savedAim = this.aimDir.clone();
      const savedTarget = this.camTarget.clone();
      const savedPos = this.camera.position.clone();
      const savedQuat = this.camera.quaternion.clone();
      const savedPhase = this.phase;
      const savedScreen = this.screen;
      this.screen = "play";
      this.phase = "aim";
      this.aimDir.set(1, 0, 0);
      this.aimCam.copy(this.aimDir);
      this.camTarget.set(cue.pos.x, TABLE.feltY + cue.radius, cue.pos.z);
      this.placeCamera(1 / 60, true);
      this.updateAimVisuals();
      this.stick.updateWorldMatrix(true, true);
      const tip = new THREE.Vector3().applyMatrix4(this.stick.matrixWorld);
      const butt = new THREE.Vector3(0, 3.8, 0).applyMatrix4(this.stick.matrixWorld);
      const along = tip.clone().sub(butt);
      along.y = 0;
      along.normalize();
      const aimDot = along.dot(this.aimDir);
      logs.push(`cueAlongAim=${aimDot.toFixed(3)} (expect > 0.92)`);
      if (aimDot < 0.92) logs.push("FAIL cue does not point along the shot");
      const tipBehind = cue.pos.clone().sub(tip);
      tipBehind.y = 0;
      if (tipBehind.dot(this.aimDir) <= 0) logs.push("FAIL cue tip is not behind the ball");
      if (butt.y <= tip.y) logs.push("FAIL cue butt is not lifted above the tip");
      logs.push(`camBehind dx=${(this.camera.position.x - cue.pos.x).toFixed(3)} (expect < 0)`);
      if (this.camera.position.x >= cue.pos.x) logs.push("FAIL camera not behind cue on -x");
      this.camera.getWorldDirection(this.fwd);
      const xzDot = this.fwd.x * this.aimDir.x + this.fwd.z * this.aimDir.z;
      logs.push(`camDir·aim xz=${xzDot.toFixed(3)} (expect > 0.55)`);
      if (xzDot <= 0.55) logs.push("FAIL camera not looking along aimDir");
      this.aimDir.copy(savedAim);
      this.camTarget.copy(savedTarget);
      this.camera.position.copy(savedPos);
      this.camera.quaternion.copy(savedQuat);
      this.phase = savedPhase;
      this.screen = savedScreen;
    }
    this.placeCamera();
    this.camera.getWorldDirection(this.fwd);
    logs.push(`camDir y=${this.fwd.y.toFixed(3)} (expect < 0, looking down)`);
    if (this.fwd.y >= 0) logs.push("FAIL cam looking up");
    this.ndc.set(0, 0);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.feltPlane, this.tmp);
    logs.push(hit ? `center ray hit felt ${this.tmp.x.toFixed(2)},${this.tmp.z.toFixed(2)}` : "FAIL center ray missed felt");
    if (cue) {
      const x0 = cue.pos.x;
      cue.asleep = false;
      cue.vel.set(6, 0, 0);
      const impacts: Impact[] = [];
      this.sim.step(0.2, impacts);
      logs.push(`+x impulse dx=${(cue.pos.x - x0).toFixed(3)} (expect > 0)`);
      if (cue.pos.x <= x0) logs.push("FAIL +x impulse moved the wrong way");
      const box = cageBounds();
      const r = cue.radius;
      cue.pos.set(box.halfX - r - 0.04, TABLE.feltY + r + 0.2, 0);
      cue.vel.set(22, 6, 0);
      cue.asleep = false;
      const cageHits: Impact[] = [];
      this.sim.step(0.35, cageHits);
      const inside =
        Math.abs(cue.pos.x) + r <= box.halfX + 0.02 &&
        Math.abs(cue.pos.z) + r <= box.halfZ + 0.02 &&
        cue.pos.y + r <= box.yMax + 0.02;
      logs.push(`cage contain inside=${inside} x=${cue.pos.x.toFixed(2)} vx=${cue.vel.x.toFixed(2)}`);
      if (!inside) logs.push("FAIL ball escaped the cage");
      if (cue.vel.x > 0.05) logs.push("FAIL cage bounce did not reverse +x");
    } else logs.push("FAIL no ball to test");
    return logs;
  }
}


