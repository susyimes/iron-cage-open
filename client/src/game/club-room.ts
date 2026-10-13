import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { contactShadowTexture } from "./textures.ts";
import { roomMaterials, type RoomMaterials } from "./room-materials.ts";

const ROOM = { halfX: 10.4, halfZ: 7.6, height: 5.6 };
type FadeMaterial = { material: THREE.Material; opacity: number; depthWrite: boolean };
type Section = { group: THREE.Group; normal: THREE.Vector3; plane: number; overhead: boolean; opacity: number; materials: FadeMaterial[] };
export type ClubRoom = { group: THREE.Group; sections: Section[] };

/** Merge decorative geometry by material: upholstered buttons and bottle caps cost no extra draw calls. */
class Batch {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    if (geo !== geometry) geometry.dispose();
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const list = this.parts.get(material) ?? [];
    list.push(geo); this.parts.set(material, list);
  }
  box(material: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, round = 0): void {
    this.add(round ? new RoundedBoxGeometry(w, h, d, 2, round) : new THREE.BoxGeometry(w, h, d), material, x, y, z);
  }
  cylinder(material: THREE.Material, rt: number, rb: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0, open = false): void {
    this.add(new THREE.CylinderGeometry(rt, rb, h, 20, 1, open), material, x, y, z, rx, 0, rz);
  }
  finish(group: THREE.Group, fading = false): FadeMaterial[] {
    const fade: FadeMaterial[] = [];
    for (const [source, geometries] of this.parts) {
      const geometry = mergeGeometries(geometries);
      if (!geometry) throw new Error("Club geometry could not be merged");
      for (const part of geometries) part.dispose();
      const material = fading ? source.clone() : source;
      if (fading) { fade.push({ material, opacity: source.opacity, depthWrite: source.depthWrite }); material.transparent = true; }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = "club-detail";
      mesh.receiveShadow = !source.transparent;
      group.add(mesh);
    }
    this.parts.clear();
    return fade;
  }
}

export function buildClubRoom(parent: THREE.Group): ClubRoom {
  const group = new THREE.Group(); group.name = "private-billiard-club"; parent.add(group);
  const mats = roomMaterials();
  const shadow = new THREE.MeshBasicMaterial({ map: contactShadowTexture(), color: 0x070b08, transparent: true, opacity: 0.45, depthWrite: false });
  const floor = new Batch();
  floor.add(new THREE.PlaneGeometry(32, 28), mats.stone, 0, -0.012, 0, -Math.PI / 2);
  floor.add(new THREE.PlaneGeometry(12, 8.4), mats.rug, 0, 0.006, 0, -Math.PI / 2);
  // A pair of brass inlays separates the quiet playing carpet from the stone circulation area.
  for (const offset of [0, 0.1]) {
    for (const z of [-5.15 - offset, 5.15 + offset]) floor.box(mats.brass, 16.6 + offset * 2, 0.009, 0.018, 0, 0.002, z);
    for (const x of [-8.3 - offset, 8.3 + offset]) floor.box(mats.brass, 0.018, 0.009, 10.3 + offset * 2, x, 0.002, 0);
  }
  floor.finish(group);

  const sections: Section[] = [];
  function wall(name: string, width: number, x: number, z: number, rotation: number, furnish: (b: Batch) => void) {
    const side = new THREE.Group(); side.name = name; side.position.set(x, 0, z); side.rotation.y = rotation; group.add(side);
    const b = new Batch();
    architecture(b, mats, width);
    furnish(b);
    const normal = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    sections.push({ group: side, normal, plane: normal.dot(side.position), overhead: false, opacity: 1, materials: b.finish(side, true) });
  }
  wall("club-back-bar", ROOM.halfX * 2, 0, -ROOM.halfZ, 0, b => {
    backBar(b, mats);
    for (const x of [-7.5, 7.5]) { armchair(b, mats, x, 1.45); sideTable(b, mats, x > 0 ? 5.8 : -5.8, 1.8); }
  });
  wall("club-lounge", ROOM.halfX * 2, 0, ROOM.halfZ, Math.PI, b => {
    for (const x of [-5.1, 5.1]) sofa(b, mats, x, 1.05);
    plaque(b, mats, 0, 3.1, 4.5, 2.25);
    sideTable(b, mats, 0, 1.65);
  });
  wall("club-cue-gallery", ROOM.halfZ * 2, -ROOM.halfX, 0, Math.PI / 2, b => {
    cueRack(b, mats);
    for (const x of [-5.1, 5.1]) { armchair(b, mats, x, 1.1); sideTable(b, mats, x > 0 ? 3.45 : -3.45, 1.55); }
  });
  wall("club-members-lounge", ROOM.halfZ * 2, ROOM.halfX, 0, -Math.PI / 2, b => {
    sofa(b, mats, 0, 1.05);
    plaque(b, mats, 0, 3.45, 4.5, 2.25);
    for (const x of [-4.4, 4.4]) sideTable(b, mats, x, 1.5);
  });
  // Soft, inexpensive grounding for furniture that does not need an additional shadow light.
  for (const section of sections) {
    const shadows = new Batch();
    shadows.add(new THREE.PlaneGeometry(section.normal.x ? 12 : 18, 2.5), shadow, 0, 0.015, 1.05, -Math.PI / 2);
    section.materials.push(...shadows.finish(section.group, true));
  }

  const overhead = new THREE.Group(); overhead.name = "club-pendant"; group.add(overhead);
  const lights = new Batch();
  lights.add(new THREE.PlaneGeometry(ROOM.halfX * 2, ROOM.halfZ * 2), mats.plaster, 0, ROOM.height, 0, Math.PI / 2);
  for (const z of [-4.2, 4.2]) {
    lights.box(mats.walnut, 16, 0.12, 0.18, 0, 5.54, z);
    lights.box(mats.brass, 15.9, 0.016, 0.026, 0, 5.472, z);
  }
  for (const x of [-8, -4.4, 4.4, 8]) {
    lights.box(mats.walnut, 0.18, 0.12, 13, x, 5.54, 0);
    lights.box(mats.brass, 0.026, 0.016, 12.9, x, 5.472, 0);
  }
  for (const x of [-1.9, 1.9]) {
    lights.cylinder(mats.brass, 0.018, 0.018, 0.31, x, 5.41, 0);
    lights.cylinder(mats.brass, 0.12, 0.12, 0.045, x, 5.56, 0);
  }
  lights.cylinder(mats.brass, 0.035, 0.035, 5.6, 0, 5.25, 0, 0, Math.PI / 2);
  for (const x of [-2.5, 0, 2.5]) {
    lights.cylinder(mats.brass, 0.028, 0.028, 0.5, x, 5.02, 0);
    lights.cylinder(mats.enamel, 0.2, 0.66, 0.43, x, 4.66, 0, 0, 0, true);
    lights.cylinder(mats.brass, 0.22, 0.22, 0.035, x, 4.89, 0);
    lights.cylinder(mats.warm, 0.59, 0.59, 0.012, x, 4.455, 0);
    lights.add(new THREE.TorusGeometry(0.655, 0.025, 8, 32), mats.brass, x, 4.45, 0, Math.PI / 2);
  }
  sections.push({ group: overhead, normal: new THREE.Vector3(0, 1, 0), plane: 4.45, overhead: true, opacity: 1, materials: lights.finish(overhead, true) });
  return { group, sections };
}

export function updateClubRoomView(room: ClubRoom, camera: THREE.Camera, dt: number): void {
  const blend = 1 - Math.exp(-12 * dt);
  for (const section of room.sections) {
    const distance = camera.position.dot(section.normal) - section.plane;
    const target = 1 - THREE.MathUtils.smoothstep(distance, section.overhead ? -0.3 : -0.7, section.overhead ? 0.65 : 1.0);
    section.opacity += (target - section.opacity) * blend;
    section.group.visible = section.opacity > 0.01;
    for (const part of section.materials) {
      part.material.opacity = part.opacity * section.opacity;
      part.material.depthWrite = part.depthWrite && section.opacity > 0.99;
    }
  }
}

function architecture(b: Batch, m: RoomMaterials, width: number): void {
  b.box(m.plaster, width, ROOM.height, 0.18, 0, ROOM.height / 2, -0.12);
  b.box(m.walnut, width, 1.48, 0.12, 0, 0.78, 0.025);
  b.box(m.dark, width, 0.15, 0.16, 0, 0.075, 0.08);
  for (const y of [0.2, 1.46]) b.box(m.brass, width, 0.024, 0.06, 0, y, 0.115);
  b.box(m.walnut, width, 0.18, 0.35, 0, 5.27, 0.07);
  b.box(m.warm, width - 0.16, 0.035, 0.065, 0, 5.13, 0.2);
  b.box(m.dark, width, 0.16, 0.6, 0, 5.5, 0.19);
  const bays = Math.round(width / 2.7), step = width / bays;
  for (let i = 0; i < bays; i++) {
    const x = -width / 2 + step * (i + 0.5);
    b.box(m.walnut, step - 0.15, 2.98, 0.05, x, 3.08, 0.01);
    b.box(m.green, step - 0.31, 2.76, 0.025, x, 3.08, 0.048);
    frame(b, m.brass, x, 3.08, 0.07, step - 0.35, 2.7, 0.018);
    frame(b, m.brass, x, 0.82, 0.106, step - 0.35, 0.95, 0.013);
    if (i % 2 === 0 && Math.abs(x + step / 2) > 4.2) sconce(b, m, x + step / 2, 3.2);
  }
}

function frame(b: Batch, material: THREE.Material, x: number, y: number, z: number, w: number, h: number, t: number): void {
  for (const dx of [-w / 2, w / 2]) b.box(material, t, h, t, x + dx, y, z);
  for (const dy of [-h / 2, h / 2]) b.box(material, w, t, t, x, y + dy, z);
}

function sconce(b: Batch, m: RoomMaterials, x: number, y: number): void {
  b.box(m.brass, 0.23, 1.1, 0.1, x, y, 0.18, 0.025);
  b.box(m.warm, 0.105, 0.62, 0.14, x, y, 0.28, 0.03);
  for (const dy of [-0.38, 0.38]) b.box(m.brass, 0.29, 0.07, 0.24, x, y + dy, 0.28);
}

function plaque(b: Batch, m: RoomMaterials, x: number, y: number, w: number, h: number): void {
  b.box(m.dark, w + 0.16, h + 0.16, 0.1, x, y, 0.16);
  b.add(new THREE.PlaneGeometry(w, h), m.crest, x, y, 0.221);
  frame(b, m.brass, x, y, 0.23, w + 0.03, h + 0.03, 0.035);
}

function backBar(b: Batch, m: RoomMaterials): void {
  for (const x of [-2.5, 0, 2.5]) {
    b.box(m.dark, 2.28, 3.1, 0.22, x, 2.84, 0.24);
    b.box(m.amber, 2.08, 2.5, 0.04, x, 2.65, 0.37);
    for (const dx of [-1.09, 1.09]) b.box(m.brass, 0.042, 2.47, 0.4, x + dx, 2.65, 0.47);
    b.add(new THREE.TorusGeometry(1.08, 0.024, 6, 32, Math.PI), m.brass, x, 3.26, 0.65);
    for (const y of [1.55, 2.35, 3.18]) {
      b.box(m.marble, 2.12, 0.075, 0.64, x, y, 0.6);
      b.box(m.warm, 2.0, 0.018, 0.055, x, y - 0.055, 0.84);
      for (let i = 0; i < 5; i++) {
        const bx = x - 0.76 + i * 0.38, h = 0.37 + (i % 3) * 0.045;
        const glass = i % 2 ? m.bottle : m.brandy;
        if (i % 3 === 2) b.box(glass, 0.2, h, 0.17, bx, y + 0.05 + h / 2, 0.65, 0.025);
        else b.cylinder(glass, 0.087, 0.092, h, bx, y + 0.05 + h / 2, 0.65);
        b.cylinder(glass, 0.037, 0.069, 0.11, bx, y + 0.105 + h, 0.65);
        b.cylinder(m.brass, 0.041, 0.041, 0.055, bx, y + 0.18 + h, 0.65);
        b.box(m.linen, 0.098, 0.14, 0.008, bx, y + 0.17, 0.742);
      }
    }
  }
  b.box(m.dark, 8.25, 1.07, 1.0, 0, 0.58, 1.32);
  b.box(m.green, 8.1, 0.96, 0.13, 0, 0.6, 1.87);
  for (let x = -3.9; x < 4; x += 0.16) b.box(m.walnut, 0.048, 0.9, 0.065, x, 0.61, 1.956);
  b.box(m.marble, 8.55, 0.14, 1.45, 0, 1.18, 1.32, 0.04);
  b.box(m.brass, 8.5, 0.024, 0.018, 0, 1.14, 2.05);
  b.box(m.warm, 7.8, 0.022, 0.025, 0, 0.13, 1.96);
  for (const x of [-2.8, 0, 2.8]) {
    b.cylinder(m.dark, 0.35, 0.4, 0.06, x, 0.04, 2.9);
    b.cylinder(m.brass, 0.045, 0.065, 0.66, x, 0.4, 2.9);
    b.add(new THREE.TorusGeometry(0.24, 0.023, 6, 20), m.brass, x, 0.26, 2.9, Math.PI / 2);
    b.cylinder(m.leather, 0.38, 0.34, 0.18, x, 0.82, 2.9);
  }
}

function sofa(b: Batch, m: RoomMaterials, x: number, z: number, width = 4.5): void {
  b.box(m.dark, width - 0.15, 0.19, 1.32, x, 0.24, z, 0.04);
  b.box(m.leather, width, 0.28, 1.35, x, 0.49, z, 0.12);
  b.box(m.leather, width, 0.84, 0.29, x, 0.99, z - 0.54, 0.12);
  const seats = width > 2 ? 3 : 1, seatWidth = (width - 0.5) / seats;
  for (let i = 0; i < seats; i++) {
    const sx = x + (i - (seats - 1) / 2) * seatWidth;
    b.box(m.leather, seatWidth - 0.025, 0.18, 1.03, sx, 0.71, z + 0.1, 0.07);
    b.box(m.leather, seatWidth - 0.035, 0.65, 0.15, sx, 1.055, z - 0.354, 0.055);
    for (const dx of [-0.25, 0.25]) for (const y of [0.98, 1.2]) b.add(new THREE.SphereGeometry(0.022, 8, 4), m.brass, sx + dx, y, z - 0.27);
  }
  for (const dx of [-width / 2 + 0.14, width / 2 - 0.14]) {
    b.box(m.leather, 0.3, 0.43, 1.38, x + dx, 0.88, z, 0.13);
    for (const dz of [-0.5, 0.5]) b.cylinder(m.brass, 0.04, 0.055, 0.2, x + dx, 0.15, z + dz);
  }
}

function armchair(b: Batch, m: RoomMaterials, x: number, z: number): void { sofa(b, m, x, z, 1.55); }

function sideTable(b: Batch, m: RoomMaterials, x: number, z: number): void {
  b.cylinder(m.marble, 0.5, 0.5, 0.065, x, 0.85, z);
  b.cylinder(m.brass, 0.047, 0.065, 0.78, x, 0.41, z);
  b.cylinder(m.brass, 0.32, 0.34, 0.045, x, 0.035, z);
  b.cylinder(m.brass, 0.14, 0.18, 0.04, x, 0.9, z);
  b.cylinder(m.brass, 0.022, 0.022, 0.43, x, 1.12, z);
  b.cylinder(m.linen, 0.2, 0.3, 0.32, x, 1.44, z, 0, 0, true);
  b.cylinder(m.warm, 0.26, 0.26, 0.012, x, 1.29, z);
}

function cueRack(b: Batch, m: RoomMaterials): void {
  b.box(m.walnut, 3.7, 2.65, 0.18, 0, 2.29, 0.22);
  frame(b, m.brass, 0, 2.29, 0.32, 3.55, 2.5, 0.025);
  for (const y of [1.07, 2.93]) b.box(m.dark, 3.35, 0.11, 0.24, 0, y, 0.42);
  for (let i = 0; i < 8; i++) {
    const x = -1.4 + i * 0.4;
    b.cylinder(m.linen, 0.012, 0.025, 1.35, x, 2.75, 0.49);
    b.cylinder(m.walnut, 0.025, 0.035, 1.0, x, 1.575, 0.49);
    b.cylinder(m.brass, 0.029, 0.029, 0.035, x, 2.09, 0.49);
  }
}
