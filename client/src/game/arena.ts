import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CAGE, TABLE, pocketLayout, tableOuter } from "./config.ts";
import { buildCushionWalls, type Wall } from "./physics.ts";
import { worldMaterials, type WorldMats } from "./textures.ts";
import { buildClubRoom, updateClubRoomView, type ClubRoom } from "./club-room.ts";

export type Arena = {
  group: THREE.Group;
  mats: WorldMats;
  walls: Wall[];
  feltY: number;
  lamp: THREE.SpotLight;
  cageFade: CageFade[];
  room: ClubRoom;
};

type CageFade = { normal: THREE.Vector3; plane: number; material: THREE.Material; opacity: number };

/** Fade only camera-side steel, leaving the far wall readable as a real boundary. */
export function updateArenaView(arena: Arena, camera: THREE.Camera, dt: number): void {
  updateClubRoomView(arena.room, camera, dt);
  const blend = 1 - Math.exp(-12 * dt);
  for (const part of arena.cageFade) {
    const facing = THREE.MathUtils.smoothstep(camera.position.dot(part.normal) - part.plane, -0.2, 0.55);
    const target = part.opacity * (1 - facing * 0.96);
    part.material.opacity += (target - part.material.opacity) * blend;
  }
}

export function buildArena(scene: THREE.Scene): Arena {
  const mats = worldMaterials();
  const group = new THREE.Group();
  group.name = "arena";
  scene.add(group);

  const outer = tableOuter();
  const feltY = TABLE.feltY;
  const l2 = TABLE.length / 2;
  const w2 = TABLE.width / 2;
  const pockets = pocketLayout();

  const room = buildClubRoom(group);

  const slate = new THREE.Mesh(new THREE.BoxGeometry(outer.halfX * 2, 0.16, outer.halfZ * 2), mats.slate);
  slate.position.set(0, feltY - 0.1, 0);
  slate.castShadow = true;
  slate.receiveShadow = true;
  group.add(slate);

  const felt = makeFelt(mats);
  felt.position.y = feltY + 0.002;
  felt.receiveShadow = true;
  group.add(felt);

  const brass = new THREE.MeshStandardMaterial({ color: 0xc5a365, metalness: 0.8, roughness: 0.32 });
  const legGeo = new THREE.CylinderGeometry(0.2, 0.15, feltY - 0.08, 8);
  for (const [x, z] of [
    [-l2 + 0.35, -w2 + 0.35],
    [l2 - 0.35, -w2 + 0.35],
    [-l2 + 0.35, w2 - 0.35],
    [l2 - 0.35, w2 - 0.35],
  ] as const) {
    const leg = new THREE.Mesh(legGeo, mats.wood);
    leg.position.set(x, (feltY - 0.08) / 2, z);
    leg.castShadow = true;
    group.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 12), brass);
    foot.position.set(x, 0.06, z);
    group.add(foot);
  }

  for (const z of [-w2 - 0.08, w2 + 0.08]) {
    const apron = new THREE.Mesh(new RoundedBoxGeometry(TABLE.length + 0.3, 0.36, 0.2, 2, 0.04), mats.wood);
    apron.position.set(0, feltY - 0.3, z); apron.castShadow = true; group.add(apron);
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(TABLE.length + 0.14, 0.018, 0.014), brass);
    inlay.position.set(0, feltY - 0.37, z + Math.sign(z) * 0.106); group.add(inlay);
  }
  for (const x of [-l2 - 0.08, l2 + 0.08]) {
    const apron = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.36, TABLE.width + 0.3, 2, 0.04), mats.wood);
    apron.position.set(x, feltY - 0.3, 0); apron.castShadow = true; group.add(apron);
  }

  addRails(group, mats);
  addPockets(group, mats, pockets);
  const cageFade = addCage(group, mats, outer, feltY);

  const lamp = new THREE.SpotLight(0xfff1dd, 58, 18, 1.02, 0.65, 2);
  lamp.position.set(0, feltY + 5.4, 0.2);
  lamp.target.position.set(0, feltY, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.00018;
  lamp.shadow.normalBias = 0.008;
  lamp.shadow.radius = 2;
  lamp.shadow.camera.near = 0.4;
  lamp.shadow.camera.far = 14;
  group.add(lamp);
  group.add(lamp.target);
  const wash = new THREE.SpotLight(0xdcebed, 18, 16, 1.15, 0.75, 2);
  wash.position.set(0.2, feltY + 6.4, 0);
  wash.target.position.set(0, feltY, 0);
  wash.castShadow = false;
  group.add(wash);
  group.add(wash.target);

  const fill = new THREE.PointLight(0xffd7ac, 3.8, 14, 2);
  fill.position.set(-3.2, feltY + 1.4, 2.4);
  group.add(fill);
  const fill2 = new THREE.PointLight(0xc1dfeb, 4.6, 14, 2);
  fill2.position.set(3.4, feltY + 1.2, -2.2);
  group.add(fill2);

  const walls = buildCushionWalls();
  return { group, mats, walls, feltY, lamp, cageFade, room };
}

function makeFelt(mats: WorldMats): THREE.Mesh {
  const l = TABLE.length;
  const w = TABLE.width;
  const shape = new THREE.Shape();
  shape.moveTo(-l / 2, w / 2);
  shape.lineTo(l / 2, w / 2);
  shape.lineTo(l / 2, -w / 2);
  shape.lineTo(-l / 2, -w / 2);
  shape.closePath();
  for (const p of pocketLayout()) {
    const hole = new THREE.Path();
    hole.absarc(p.x, -p.z, p.r * 0.92, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const geo = new THREE.ShapeGeometry(shape, 18);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const n = geo.getAttribute("normal");
  if (n && n.getY(0) < 0) {
    geo.scale(1, 1, -1);
    geo.computeVertexNormals();
  }
  assertUp(geo, "felt");
  remapFeltUv(geo);
  return new THREE.Mesh(geo, mats.felt);
}

function remapFeltUv(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute("position");
  const uv = geo.getAttribute("uv");
  if (!pos || !uv) return;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv.setXY(i, x / TABLE.length + 0.5, z / TABLE.width + 0.5);
  }
  uv.needsUpdate = true;
}

function addRails(group: THREE.Group, mats: WorldMats): void {
  const l2 = TABLE.length / 2;
  const w2 = TABLE.width / 2;
  const t = TABLE.cushionT;
  const h = TABLE.cushionH;
  const y = TABLE.feltY + h / 2;
  const cr = TABLE.pocketR;
  const sr = TABLE.sidePocketR;

  const mk = (sx: number, sy: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 2, 0.018), mats.wood);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    const cap = new THREE.Mesh(new RoundedBoxGeometry(sx * 0.98, sy * 0.42, sz * 0.98, 2, 0.012), mats.wood);
    cap.position.set(x, y + sy * 0.38, z);
    cap.castShadow = true;
    group.add(cap);
  };

  mk(t, h, (w2 - cr) * 2, l2 + t / 2, 0);
  mk(t, h, (w2 - cr) * 2, -l2 - t / 2, 0);
  const long = l2 - cr - sr;
  mk(long, h, t, -l2 + cr + long / 2, w2 + t / 2);
  mk(long, h, t, l2 - cr - long / 2, w2 + t / 2);
  mk(long, h, t, -l2 + cr + long / 2, -w2 - t / 2);
  mk(long, h, t, l2 - cr - long / 2, -w2 - t / 2);

  const rubber = (sx: number, sy: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats.rubber);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
  };
  rubber(0.04, h * 0.7, (w2 - cr) * 2 - 0.04, l2 - 0.02, 0);
  rubber(0.04, h * 0.7, (w2 - cr) * 2 - 0.04, -l2 + 0.02, 0);
  rubber(long - 0.04, h * 0.7, 0.04, -l2 + cr + long / 2, w2 - 0.02);
  rubber(long - 0.04, h * 0.7, 0.04, l2 - cr - long / 2, w2 - 0.02);
  rubber(long - 0.04, h * 0.7, 0.04, -l2 + cr + long / 2, -w2 + 0.02);
  rubber(long - 0.04, h * 0.7, 0.04, l2 - cr - long / 2, -w2 + 0.02);

  addRailSights(group, l2, w2, t, y, h);
}

function addRailSights(group: THREE.Group, l2: number, w2: number, t: number, railY: number, h: number): void {
  const sightMat = new THREE.MeshStandardMaterial({
    color: 0xf4eee0,
    roughness: 0.34,
    metalness: 0.08,
  });
  const sightGeo = new THREE.BoxGeometry(0.056, 0.012, 0.056);
  const capH = h * 0.38;
  const sightY = railY + h * 0.38 + capH / 2 + 0.006;
  const step = TABLE.length / 8;
  const zRail = w2 + t / 2;
  const xRail = l2 + t / 2;

  const place = (x: number, z: number) => {
    const s = new THREE.Mesh(sightGeo, sightMat);
    s.position.set(x, sightY, z);
    s.rotation.y = Math.PI / 4;
    s.castShadow = false;
    s.receiveShadow = true;
    group.add(s);
  };

  for (const z of [-zRail, zRail]) {
    for (const k of [-3, -2, -1, 1, 2, 3]) {
      place(k * step, z);
    }
  }
  for (const x of [-xRail, xRail]) {
    for (const k of [-1, 1]) {
      place(x, k * step);
    }
  }
}

function addPockets(group: THREE.Group, mats: WorldMats, pockets: ReturnType<typeof pocketLayout>): void {
  const well = new THREE.CylinderGeometry(1, 1.12, 0.55, 24, 1, true);
  const floor = new THREE.CircleGeometry(1, 20);
  const rim = new THREE.TorusGeometry(1, 0.038, 8, 20);
  const wellMat = mats.slate.clone();
  wellMat.side = THREE.DoubleSide;
  const throatMat = new THREE.MeshBasicMaterial({ color: 0x020605 });
  for (const p of pockets) {
    const throat = new THREE.Mesh(floor, throatMat);
    throat.rotation.x = -Math.PI / 2;
    throat.position.set(p.x, TABLE.feltY + 0.003, p.z);
    throat.scale.setScalar(p.r * 0.92);
    group.add(throat);
    const w = new THREE.Mesh(well, wellMat);
    w.position.set(p.x, TABLE.feltY - 0.26, p.z);
    w.scale.set(p.r * 0.92, 1, p.r * 0.92);
    group.add(w);
    const f = new THREE.Mesh(floor, mats.slate);
    f.position.set(p.x, TABLE.feltY - 0.52, p.z);
    f.rotation.x = -Math.PI / 2;
    f.scale.setScalar(p.r * 0.92);
    group.add(f);
    const r = new THREE.Mesh(rim, mats.leather);
    r.position.set(p.x, TABLE.feltY + 0.008, p.z);
    r.rotation.x = Math.PI / 2;
    r.scale.set(p.r * 0.92, p.r * 0.92, 1);
    group.add(r);
  }
}

function addCage(
  group: THREE.Group,
  mats: WorldMats,
  outer: { halfX: number; halfZ: number },
  feltY: number,
): CageFade[] {
  const h = CAGE.height;
  const y0 = feltY;
  const wallH = h * 0.72;
  const hx = outer.halfX;
  const hz = outer.halfZ;
  const fades: CageFade[] = [];
  const fading = (source: THREE.Material, nx: number, nz: number, x: number, z: number): THREE.Material => {
    const material = source.clone();
    material.transparent = true;
    material.depthWrite = false;
    const normal = new THREE.Vector3(nx, 0, nz).normalize();
    fades.push({ normal, plane: normal.x * x + normal.z * z, material, opacity: material.opacity });
    return material;
  };

  const postGeo = new THREE.CylinderGeometry(0.045, 0.05, wallH + 0.08, 10);
  const posts: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
    [0, -hz],
    [0, hz],
    [-hx, 0],
    [hx, 0],
  ];
  for (const [x, z] of posts) {
    const p = new THREE.Mesh(postGeo, fading(mats.rust, Math.sign(x), Math.sign(z), x, z));
    p.position.set(x, y0 + wallH / 2, z);
    p.castShadow = false;
    group.add(p);
  }

  const barY = [y0 + 0.04, y0 + h * 0.48];
  for (const y of barY) {
    const hxBar = new THREE.Mesh(new THREE.BoxGeometry(hx * 2 + 0.08, 0.04, 0.05), fading(mats.rust, 0, 1, 0, hz));
    const hzBarA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, hz * 2 + 0.08), fading(mats.rust, 1, 0, hx, 0));
    const hzBarB = hzBarA.clone();
    hzBarB.material = fading(mats.rust, -1, 0, -hx, 0);
    hxBar.position.set(0, y, hz);
    const hxBar2 = hxBar.clone();
    hxBar2.material = fading(mats.rust, 0, -1, 0, -hz);
    hxBar2.position.set(0, y, -hz);
    hzBarA.position.set(hx, y, 0);
    hzBarB.position.set(-hx, y, 0);
    group.add(hxBar, hxBar2, hzBarA, hzBarB);
  }

  const diamond = 0.24;
  const chainWall = (w: number, d: number, x: number, y: number, z: number, rotX: number, rotY: number) => {
    const mat = fading(mats.chain, Math.sign(x), Math.sign(z), x, z) as THREE.MeshBasicMaterial;
    const src = mats.chain.map;
    if (src) {
      const map = src.clone();
      map.repeat.set(w / diamond, d / diamond);
      mat.map = map;
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, 0);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
  };
  chainWall(hx * 2, wallH, 0, y0 + wallH / 2, hz, 0, 0);
  chainWall(hx * 2, wallH, 0, y0 + wallH / 2, -hz, 0, Math.PI);
  chainWall(hz * 2, wallH, hx, y0 + wallH / 2, 0, 0, -Math.PI / 2);
  chainWall(hz * 2, wallH, -hx, y0 + wallH / 2, 0, 0, Math.PI / 2);
  return fades;
}

function assertUp(geo: THREE.BufferGeometry, label: string): void {
  geo.computeVertexNormals();
  const n = geo.getAttribute("normal");
  if (!n) throw new Error(`${label} missing normals`);
  if (n.getY(0) < 0.2) {
    console.warn(`${label} normal y=${n.getY(0).toFixed(2)} — expected up`);
  }
}
