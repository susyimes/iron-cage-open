import * as THREE from "three";
import {
  BALL,
  PHYS,
  TABLE,
  cageBounds,
  type Pocket,
  pocketLayout,
  tableOuter,
} from "./config.ts";
import {
  cueLightMul,
  cueRadiusMul,
  cueShrinkMul,
  emptyCurses,
  enemyRadiusMul,
  feltScale,
  magnetK,
  massMul,
  type Curses,
  type Mods,
} from "./upgrades.ts";

export type WallKind = "cushion" | "cage" | "ceiling" | "floor";

export type Wall = {
  kind: WallKind;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  halfU: number;
  halfV: number;
  restitution: number;
  friction: number;
};

export type BallKind = "cue" | "enemy";

export type Ball = {
  id: number;
  kind: BallKind;
  number: number;
  radius: number;
  mass: number;
  hp: number;
  maxHp: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  omega: THREE.Vector3;
  asleep: boolean;
  stillTime: number;
  sinking: boolean;
  sinkT: number;
  pocketed: boolean;
  shattered: boolean;
  mesh: THREE.Mesh | null;
  pocket: Pocket | null;
  scored: boolean;
};

export type Impact = {
  kind: "ball" | "cushion" | "cage" | "felt" | "pocket" | "smash";
  x: number;
  y: number;
  z: number;
  speed: number;
  a?: Ball;
  b?: Ball;
};

let nextId = 1;

export function makeBall(
  kind: BallKind,
  number: number,
  radius: number,
  mass: number,
  hp: number,
  mesh: THREE.Mesh | null,
  x: number,
  y: number,
  z: number,
): Ball {
  const id = nextId;
  nextId += 1;
  return {
    id,
    kind,
    number,
    radius,
    mass,
    hp,
    maxHp: hp,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    omega: new THREE.Vector3(),
    asleep: true,
    stillTime: 1,
    sinking: false,
    sinkT: 0,
    pocketed: false,
    shattered: false,
    mesh,
    pocket: null,
    scored: false,
  };
}

export class Sim {
  balls: Ball[] = [];
  walls: Wall[] = [];
  pockets: Pocket[] = pocketLayout();
  pocketsLive = true;
  /** Eight-ball keeps physical ball sizes fixed and never destroys object balls. */
  standardPool = true;
  shotSeconds = 0;
  mods: Mods = { power: 0, size: 0, mass: 0, magnet: 0, slick: 0 };
  /** Multiplier on felt friction. 1 is a normal cloth. */
  feltGrip = 1;
  feltY = TABLE.feltY;
  private readonly n = new THREE.Vector3();
  private readonly rv = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly rel = new THREE.Vector3();
  private readonly force = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  reset(walls: Wall[]): void {
    this.walls = walls;
    this.balls = [];
  }

  live(): Ball[] {
    return this.balls.filter((b) => !b.pocketed && !b.shattered);
  }

  wake(b: Ball): void {
    b.asleep = false;
    b.stillTime = 0;
  }

  step(dt: number, impacts: Impact[]): void {
    const n = PHYS.substeps;
    const h = dt / n;
    for (let s = 0; s < n; s += 1) this.substep(h, impacts);
    this.syncMeshes(dt);
  }

  allSleeping(): boolean {
    return this.live().every((b) => b.asleep && !b.sinking);
  }

  private substep(dt: number, impacts: Impact[]): void {
    this.magnet(dt);
    for (const b of this.balls) {
      if (b.pocketed || b.shattered) continue;
      if (b.sinking) {
        this.sink(b, dt, impacts);
        continue;
      }
      if (!b.asleep) {
        b.vel.y -= PHYS.gravity * dt;
        if (b.vel.lengthSq() > 1600) b.vel.setLength(40);
        b.pos.x += b.vel.x * dt;
        b.pos.y += b.vel.y * dt;
        b.pos.z += b.vel.z * dt;
      }
    }
    const live = this.live();
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 0; i < live.length; i += 1) {
        const a = live[i];
        if (!a || a.sinking || a.shattered) continue;
        for (let j = i + 1; j < live.length; j += 1) {
          const b = live[j];
          if (!b || b.sinking || b.shattered) continue;
          this.ballBall(a, b, impacts, pass === 0);
          if (a.shattered) break;
        }
      }
    }
    for (const b of live) {
      if (b.sinking || b.shattered) continue;
      this.world(b, dt, impacts);
      this.containCage(b, impacts);
    }
  }

  private magnet(dt: number): void {
    // A short pulse cannot keep an otherwise settled table awake indefinitely.
    const k = magnetK(this.mods) * Math.max(0, 1 - this.shotSeconds / 2);
    if (k <= 0) return;
    const live = this.live().filter((b) => !b.sinking);
    for (let i = 0; i < live.length; i += 1) {
      const a = live[i];
      if (!a) continue;
      for (let j = i + 1; j < live.length; j += 1) {
        const b = live[j];
        if (!b || (a.asleep && b.asleep)) continue;
        this.rel.subVectors(b.pos, a.pos);
        const d = this.rel.length();
        if (d < a.radius + b.radius + 0.02 || d < 0.05) continue;
        const f = Math.min(k / (d * d), 16);
        this.rel.multiplyScalar(1 / d);
        a.vel.addScaledVector(this.rel, (f * dt) / a.mass);
        b.vel.addScaledVector(this.rel, -(f * dt) / b.mass);
        this.wakeIfMoving(a);
        this.wakeIfMoving(b);
      }
    }
  }

  private ballBall(a: Ball, b: Ball, impacts: Impact[], damage: boolean): void {
    this.n.subVectors(a.pos, b.pos);
    let dist = this.n.length();
    const min = a.radius + b.radius;
    if (dist >= min) return;
    if (dist < 1e-6) {
      this.n.set(1, 0, 0);
      dist = 1e-6;
    } else {
      this.n.multiplyScalar(1 / dist);
    }
    const overlap = min - dist;
    const invA = 1 / a.mass;
    const invB = 1 / b.mass;
    const inv = invA + invB;
    a.pos.addScaledVector(this.n, overlap * (invA / inv));
    b.pos.addScaledVector(this.n, -overlap * (invB / inv));
    this.rv.subVectors(a.vel, b.vel);
    const vn = this.rv.dot(this.n);
    if (vn < 0) {
      const j = (-(1 + BALL.restBall) * vn) / inv;
      a.vel.addScaledVector(this.n, j * invA);
      b.vel.addScaledVector(this.n, -j * invB);
      const speed = -vn;
      impacts.push({
        kind: "ball",
        x: (a.pos.x + b.pos.x) * 0.5,
        y: (a.pos.y + b.pos.y) * 0.5,
        z: (a.pos.z + b.pos.z) * 0.5,
        speed,
        a,
        b,
      });
      if (damage && speed > PHYS.smashSpeed) {
        const dmg = (speed - PHYS.smashSpeed) * (a.mass * b.mass) / (a.mass + b.mass) * 0.18;
        this.hurt(a, dmg, impacts);
        this.hurt(b, dmg, impacts);
      }
    }
    this.wakeIfMoving(a);
    this.wakeIfMoving(b);
  }

  hurt(b: Ball, dmg: number, impacts: Impact[]): void {
    if (this.standardPool || b.kind !== "enemy" || b.shattered || b.sinking) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.shattered = true;
      b.asleep = true;
      impacts.push({ kind: "smash", x: b.pos.x, y: b.pos.y, z: b.pos.z, speed: 8, a: b });
    }
  }

  private world(b: Ball, dt: number, impacts: Impact[]): void {
    const onCloth = b.pos.y < this.feltY + b.radius + 0.1;
    if (this.pocketsLive) {
      const pk = this.nearestPocket(b.pos.x, b.pos.z);
      if (pk) {
        const dx = b.pos.x - pk.x;
        const dz = b.pos.z - pk.z;
        const dist = Math.hypot(dx, dz);
        if (b.radius <= pk.r * 0.9 && onCloth && b.vel.y <= 2 && dist < pk.r - b.radius * 0.42) {
          b.sinking = true;
          b.pocket = pk;
          b.sinkT = 0;
          b.vel.set(0, -0.4, 0);
          impacts.push({ kind: "pocket", x: pk.x, y: this.feltY, z: pk.z, speed: 1, a: b });
          return;
        }
        const toward = b.vel.x * dx + b.vel.z * dz < 0;
        if (b.radius <= pk.r * 0.9 && onCloth && toward && dist < pk.r * 0.72 && b.vel.y <= 0.6) {
          this.force.set(-dx, -0.2, -dz).normalize();
          b.vel.addScaledVector(this.force, 2.2 * dt);
        }
      }
    }

    const outer = tableOuter();
    const inPlay = Math.abs(b.pos.x) < TABLE.length / 2 - 0.012 && Math.abs(b.pos.z) < TABLE.width / 2 - 0.012;
    const inTable = Math.abs(b.pos.x) < outer.halfX && Math.abs(b.pos.z) < outer.halfZ;
    const droppingIn = this.pocketsLive && onCloth && this.inPocketHole(b.pos.x, b.pos.z, b.radius);

    if (!droppingIn) {
      const planeY = inPlay ? this.feltY : inTable ? this.feltY + 0.045 : 0;
      const rest = inPlay ? BALL.restFelt : inTable ? BALL.restApron : 0.2;
      this.planeY(b, planeY, rest, dt, impacts);
    }

    for (const w of this.walls) {
      if (w.kind !== "cushion") continue;
      if (b.pos.y > this.feltY + TABLE.cushionH + b.radius * 0.15) continue;
      this.wall(b, w, impacts);
    }

    if (!b.asleep) this.sleepCheck(b, dt);
  }

  private planeY(b: Ball, y: number, rest: number, dt: number, impacts: Impact[]): void {
    const d = b.pos.y - y;
    if (d >= b.radius) return;
    const overlap = b.radius - d;
    b.pos.y += overlap;
    if (b.vel.y < 0) {
      const hit = -b.vel.y;
      b.vel.y = -b.vel.y * rest;
      if (hit > 0.8) impacts.push({ kind: "felt", x: b.pos.x, y, z: b.pos.z, speed: hit, a: b });
    }
    const speed = Math.hypot(b.vel.x, b.vel.z);
    if (speed > 1e-6) {
      const g = Math.max(0.05, this.feltGrip);
      const decel = PHYS.feltMu * g + (PHYS.feltVisc * g) / Math.max(0.05, b.mass) + (speed < 1.35 ? 1.6 : 0);
      const ns = Math.max(0, speed - decel * dt);
      b.vel.x *= ns / speed;
      b.vel.z *= ns / speed;
    }
    this.wakeIfMoving(b);
  }

  private containCage(b: Ball, impacts: Impact[]): void {
    if (b.sinking || b.pocketed || b.shattered) return;
    const box = cageBounds();
    const r = b.radius;
    this.bounceAxis(b, "y", b.pos.y + r - box.yMax, -1, BALL.restCeiling, impacts);
    const onCloth = b.pos.y < this.feltY + r + 0.1;
    if (this.pocketsLive && onCloth && this.inPocketHole(b.pos.x, b.pos.z, r * 0.45, r)) {
      b.pos.y = Math.min(b.pos.y, box.yMax - r);
      return;
    }
    this.bounceAxis(b, "x", b.pos.x + r - box.halfX, -1, BALL.restCage, impacts);
    this.bounceAxis(b, "x", -box.halfX - (b.pos.x - r), +1, BALL.restCage, impacts);
    this.bounceAxis(b, "z", b.pos.z + r - box.halfZ, -1, BALL.restCage, impacts);
    this.bounceAxis(b, "z", -box.halfZ - (b.pos.z - r), +1, BALL.restCage, impacts);
    if (b.pos.y - r < box.yMin && b.pos.y < this.feltY - 0.05) {
      this.bounceAxis(b, "y", box.yMin - (b.pos.y - r), +1, 0.22, impacts);
    }
    b.pos.x = THREE.MathUtils.clamp(b.pos.x, -box.halfX + r, box.halfX - r);
    b.pos.z = THREE.MathUtils.clamp(b.pos.z, -box.halfZ + r, box.halfZ - r);
    b.pos.y = Math.min(b.pos.y, box.yMax - r);
    if (!b.sinking && b.pos.y < this.feltY - 0.2) {
      const pk = this.nearestPocket(b.pos.x, b.pos.z);
      if (pk && b.radius <= pk.r * 0.9 && Math.hypot(b.pos.x - pk.x, b.pos.z - pk.z) < pk.r) {
        b.sinking = true;
        b.pocket = pk;
        b.sinkT = 0;
        impacts.push({ kind: "pocket", x: pk.x, y: this.feltY, z: pk.z, speed: 1, a: b });
      } else {
        b.pos.y = this.feltY + r;
        b.vel.y = 0;
        this.wake(b);
      }
    }
  }

  private bounceAxis(
    b: Ball,
    axis: "x" | "y" | "z",
    penetration: number,
    inward: number,
    rest: number,
    impacts: Impact[],
  ): void {
    if (penetration <= 0) return;
    b.pos[axis] += inward * penetration;
    const vn = b.vel[axis] * -inward;
    if (vn > 0) {
      b.vel[axis] = inward * vn * rest;
      if (axis === "x") {
        b.vel.y *= 0.92;
        b.vel.z *= 0.88;
      } else if (axis === "z") {
        b.vel.y *= 0.92;
        b.vel.x *= 0.88;
      } else {
        b.vel.x *= 0.9;
        b.vel.z *= 0.9;
      }
      if (vn > 0.45) {
        impacts.push({
          kind: "cage",
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
          speed: vn,
          a: b,
        });
      }
      if (vn > PHYS.smashSpeed + 0.6) {
        this.hurt(b, (vn - PHYS.smashSpeed) * 0.28 * b.mass, impacts);
      }
      this.wake(b);
    }
  }

  private wall(b: Ball, w: Wall, impacts: Impact[]): void {
    this.rel.subVectors(b.pos, w.origin);
    const d = this.rel.dot(w.normal);
    const u = this.rel.dot(w.tangent);
    const v = this.rel.dot(w.bitangent);
    if (Math.abs(u) > w.halfU + b.radius * 0.8) return;
    if (Math.abs(v) > w.halfV + b.radius * 0.8) return;
    if (d >= b.radius) return;
    const overlap = b.radius - d;
    b.pos.addScaledVector(w.normal, overlap);
    const vn = b.vel.dot(w.normal);
    if (vn < 0) {
      b.vel.addScaledVector(w.normal, -(1 + w.restitution) * vn);
      this.tan.copy(b.vel).addScaledVector(w.normal, -b.vel.dot(w.normal));
      const ts = this.tan.length();
      if (ts > 1e-6) {
        const kill = Math.min(ts, w.friction);
        b.vel.addScaledVector(this.tan, -kill / ts);
      }
      const speed = -vn;
      if (speed > 1e-5) {
        impacts.push({
          kind: w.kind === "cage" || w.kind === "ceiling" ? "cage" : "cushion",
          x: b.pos.x,
          y: b.pos.y,
          z: b.pos.z,
          speed,
          a: b,
        });
      }
      if ((w.kind === "cage" || w.kind === "ceiling") && speed > PHYS.smashSpeed + 0.6) {
        this.hurt(b, (speed - PHYS.smashSpeed) * 0.35 * b.mass, impacts);
      }
    }
    this.wakeIfMoving(b);
  }

  private sink(b: Ball, dt: number, _impacts: Impact[]): void {
    b.sinkT += dt;
    const pk = b.pocket;
    if (pk) {
      b.pos.x += (pk.x - b.pos.x) * Math.min(1, 8 * dt);
      b.pos.z += (pk.z - b.pos.z) * Math.min(1, 8 * dt);
    }
    b.pos.y -= 1.15 * dt;
    const s = Math.max(0.12, 1 - b.sinkT * 2.1);
    if (b.mesh) b.mesh.scale.setScalar(b.radius * s);
    if (b.sinkT > 0.48) {
      b.pocketed = true;
      b.sinking = false;
      if (b.mesh) b.mesh.visible = false;
    }
  }

  private nearestPocket(x: number, z: number): Pocket | null {
    let best: Pocket | null = null;
    let bd = Infinity;
    for (const p of this.pockets) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r * 1.35 && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private inPocketHole(x: number, z: number, radius: number, fitRadius = radius): boolean {
    for (const p of this.pockets) {
      if (fitRadius > p.r * 0.9) continue;
      if (Math.hypot(x - p.x, z - p.z) < p.r - radius * 0.15) return true;
    }
    return false;
  }

  private sleepCheck(b: Ball, dt: number): void {
    const sp = b.vel.length();
    if (sp < PHYS.sleepSpeed && b.pos.y <= this.feltY + b.radius + 0.04) {
      b.stillTime += dt;
      if (b.stillTime > PHYS.sleepTime) {
        b.asleep = true;
        b.vel.set(0, 0, 0);
      }
    } else {
      b.stillTime = 0;
    }
  }

  private wakeIfMoving(b: Ball): void {
    if (b.vel.lengthSq() > PHYS.sleepSpeed * PHYS.sleepSpeed) this.wake(b);
  }

  private syncMeshes(dt: number): void {
    for (const b of this.balls) {
      if (!b.mesh) continue;
      if (b.pocketed || b.shattered) {
        if (b.shattered) b.mesh.visible = false;
        continue;
      }
      b.mesh.position.copy(b.pos);
      if (!b.asleep && !b.sinking) {
        this.n.copy(b.vel).cross(this.up);
        const w = this.n.length() / Math.max(b.radius, 0.01);
        if (w > 0.01) {
          this.n.normalize();
          b.mesh.rotateOnWorldAxis(this.n, w * dt);
        }
      }
      if (b.mesh.material instanceof THREE.MeshStandardMaterial) {
        if (b.kind === "enemy") {
          const hurt = 1 - Math.max(0, b.hp) / b.maxHp;
          b.mesh.material.emissive.setHex(this.mods.magnet > 0 ? 0x1a4a66 : 0x5a0000);
          b.mesh.material.emissiveIntensity = Math.max(hurt * 0.55, this.mods.magnet > 0 ? 0.18 : 0);
        } else {
          b.mesh.material.emissive.setHex(this.mods.magnet > 0 ? 0x2a88aa : 0x000000);
          b.mesh.material.emissiveIntensity = this.mods.magnet > 0 ? 0.22 : 0;
        }
      }
    }
  }

  refreshVisuals(): void { this.syncMeshes(0); }

  applyMods(mods: Mods, curses: Curses = emptyCurses()): void {
    this.mods = { ...mods };
    this.feltGrip = feltScale(mods, curses);
    const enemyR = BALL.radius * (this.standardPool ? 1 : enemyRadiusMul(curses));
    const cueR = BALL.radius * (this.standardPool ? 1 : cueRadiusMul(mods) * cueShrinkMul(curses));
    const heavy = massMul(mods);
    const light = cueLightMul(curses);
    let grew = false;
    for (const b of this.balls) {
      if (b.pocketed || b.shattered) continue;
      const oldRadius = b.radius;
      if (b.kind === "cue") {
        b.radius = cueR;
        if (cueR > oldRadius + 1e-4) grew = true;
        b.mass = BALL.mass * heavy * light * (cueR / BALL.radius) ** 3;
      } else {
        if (enemyR > b.radius + 1e-4) grew = true;
        b.radius = enemyR;
        b.mass = BALL.mass * heavy;
      }
      if (b.asleep || b.pos.y < this.feltY + oldRadius + 0.02) b.pos.y = this.feltY + b.radius;
      if (b.mesh) b.mesh.scale.setScalar(b.radius);
    }
    if (grew && !this.standardPool) this.separate();
    this.refreshVisuals();
  }

  /** Push resting balls apart so a radius change does not start them inside each other. */
  separate(): void {
    const live = this.balls.filter((b) => !b.pocketed && !b.shattered && !b.sinking);
    for (let n = 0; n < 16; n += 1) {
      for (let i = 0; i < live.length; i += 1) {
        const a = live[i];
        if (!a) continue;
        for (let j = i + 1; j < live.length; j += 1) {
          const b = live[j];
          if (!b) continue;
          const dx = a.pos.x - b.pos.x;
          const dz = a.pos.z - b.pos.z;
          const dist = Math.hypot(dx, dz);
          const min = a.radius + b.radius;
          if (dist >= min) continue;
          const push = (min - dist) / 2 + 0.0004;
          const nx = dist < 1e-6 ? 1 : dx / dist;
          const nz = dist < 1e-6 ? 0 : dz / dist;
          a.pos.x += nx * push;
          a.pos.z += nz * push;
          b.pos.x -= nx * push;
          b.pos.z -= nz * push;
          clampOnFelt(a);
          clampOnFelt(b);
        }
      }
    }
  }
}

function clampOnFelt(b: Ball): void {
  const x = TABLE.length / 2 - b.radius - 0.08;
  const z = TABLE.width / 2 - b.radius - 0.08;
  b.pos.x = Math.max(-x, Math.min(x, b.pos.x));
  b.pos.z = Math.max(-z, Math.min(z, b.pos.z));
}

export function buildCushionWalls(): Wall[] {
  const feltY = TABLE.feltY;
  const ch = TABLE.cushionH;
  const l2 = TABLE.length / 2;
  const w2 = TABLE.width / 2;
  const cr = TABLE.pocketR;
  const sr = TABLE.sidePocketR;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const walls: Wall[] = [];
  const cush = (ox: number, oz: number, nx: number, nz: number, halfU: number) => {
    walls.push({
      kind: "cushion",
      origin: new THREE.Vector3(ox, feltY + ch / 2, oz),
      normal: new THREE.Vector3(nx, 0, nz),
      tangent: nx !== 0 ? zAxis.clone() : xAxis.clone(),
      bitangent: yAxis.clone(),
      halfU,
      halfV: ch / 2,
      restitution: BALL.restCushion,
      friction: 0.12,
    });
  };
  cush(l2, 0, -1, 0, w2 - cr);
  cush(-l2, 0, 1, 0, w2 - cr);
  const long = (l2 - cr - sr) / 2;
  const mid = cr + long;
  cush(-l2 + mid, w2, 0, -1, long);
  cush(l2 - mid, w2, 0, -1, long);
  cush(-l2 + mid, -w2, 0, 1, long);
  cush(l2 - mid, -w2, 0, 1, long);
  return walls;
}

export function impulseCue(b: Ball, dir: THREE.Vector3, speed: number, loft: number): void {
  b.asleep = false;
  b.stillTime = 0;
  b.vel.addScaledVector(dir, speed);
  b.vel.y += speed * loft;
}
