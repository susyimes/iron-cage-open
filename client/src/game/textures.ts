import * as THREE from "three";
import { ballColor, isStripe } from "./config.ts";

function canvas(w: number, h = w): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d missing");
  return { c, ctx };
}

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 5; i += 1) {
    v += noise(x * freq, y * freq, seed + i * 19) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v;
}

function toTex(c: HTMLCanvasElement, srgb = true, wrap = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 8;
  if (wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

function feltHeight(x: number, y: number): number {
  const weave = Math.sin(x * 1.1) * Math.sin(y * 1.1) * 0.1;
  return weave + (noise(x / 3, y / 3, 11) - 0.5) * 0.16;
}

export function feltTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const v = y / h;
      const nap = feltHeight(x, y);
      const wear = (fbm(x / 140, y / 140, 34) - 0.5) * 7;
      const edge = Math.max(0, Math.abs(u - 0.5) * 2 - 0.85) * 20 + Math.max(0, Math.abs(v - 0.5) * 2 - 0.85) * 20;
      const grit = (hash(x, y, 9) - 0.5) * 6;
      const i = (y * w + x) * 4;
      img.data[i] = 20 + nap * 4 + wear * 0.3 - edge * 0.25 + grit * 0.3;
      img.data[i + 1] = 85 + nap * 7 + wear - edge * 0.8 + grit;
      img.data[i + 2] = 57 + nap * 4 + wear * 0.6 - edge * 0.5 + grit * 0.5;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(244, 236, 214, 0.28)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(w * 0.25, 18);
  ctx.lineTo(w * 0.25, h - 18);
  ctx.stroke();
  ctx.fillStyle = "rgba(244, 236, 214, 0.7)";
  ctx.beginPath();
  ctx.arc(w * 0.75, h / 2, 5.5, 0, Math.PI * 2);
  ctx.fill();
  return toTex(c, true, false);
}

export function feltNormalTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const sx = 1024 / w;
  const sy = 512 / h;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const hL = feltHeight((x - 1) * sx, y * sy);
      const hR = feltHeight((x + 1) * sx, y * sy);
      const hD = feltHeight(x * sx, (y - 1) * sy);
      const hU = feltHeight(x * sx, (y + 1) * sy);
      const dx = (hL - hR) * 1.4;
      const dy = (hD - hU) * 1.4;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = (dx / len) * 127 + 128;
      img.data[i + 1] = (dy / len) * 127 + 128;
      img.data[i + 2] = (1 / len) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTex(c, false, false);
}

/** Polished walnut. Grain runs along X so long rails read as a single board. */
export function woodTexture(): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const along = x / w;
      const across = y / h;
      const flow = fbm(along * 3.2, across * 1.4, 3);
      const pore = Math.sin(across * Math.PI * 46 + flow * 5 + along * 2.4);
      const ribbon = Math.sin(across * Math.PI * 7 + flow * 2.2);
      const glint = Math.max(0, fbm(along * 8, across * 2, 27) - 0.62) * 0.55;
      const t = 0.32 + flow * 0.28 + pore * 0.065 + ribbon * 0.045 + glint;
      const i = (y * w + x) * 4;
      img.data[i] = 40 + t * 70;
      img.data[i + 1] = 22 + t * 39;
      img.data[i + 2] = 12 + t * 18;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTex(c);
  tex.repeat.set(1.5, 2);
  return tex;
}

/** Maple shaft: streaks run along V, which a cue cylinder uses as its length. */
export function cueWoodTexture(dark: boolean): THREE.CanvasTexture {
  const w = 128;
  const h = 512;
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const around = x / w;
      const along = y / h;
      const flow = fbm(along * 2.4, around * 6, dark ? 9 : 4);
      const line = Math.sin(around * Math.PI * 22 + flow * 4 + along * 1.6);
      const t = 0.5 + flow * 0.28 + line * 0.08;
      const i = (y * w + x) * 4;
      if (dark) {
        img.data[i] = 78 + t * 52;
        img.data[i + 1] = 28 + t * 18;
        img.data[i + 2] = 14 + t * 8;
      } else {
        img.data[i] = 176 + t * 48;
        img.data[i + 1] = 132 + t * 36;
        img.data[i + 2] = 78 + t * 18;
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTex(c, true, true);
  tex.repeat.set(1, 1);
  return tex;
}

export function rustTexture(): THREE.CanvasTexture {
  const { c, ctx } = canvas(256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const n = fbm(x / 40, y / 40, 8);
      const rust = Math.max(0, n - 0.48);
      const i = (y * 256 + x) * 4;
      img.data[i] = 70 + n * 50 + rust * 90;
      img.data[i + 1] = 68 + n * 40 - rust * 20;
      img.data[i + 2] = 72 + n * 38 - rust * 40;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTex(c);
  tex.repeat.set(2, 2);
  return tex;
}

export function concreteTexture(): THREE.CanvasTexture {
  const { c, ctx } = canvas(512);
  const img = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y += 1) {
    for (let x = 0; x < 512; x += 1) {
      const n = fbm(x / 90, y / 90, 21);
      const crack = Math.max(0, 0.08 - Math.abs(fbm(x / 40, y / 40, 5) - 0.5)) * 80;
      const grit = (hash(x, y, 2) - 0.5) * 22;
      const i = (y * 512 + x) * 4;
      const g = 48 + n * 28 - crack + grit;
      img.data[i] = g;
      img.data[i + 1] = g * 0.96;
      img.data[i + 2] = g * 0.9;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = toTex(c);
  tex.repeat.set(6, 6);
  return tex;
}

export function chainLinkTexture(): THREE.CanvasTexture {
  // One diamond per tile. The old texture contained 18 diamonds and was then
  // repeated once per wire opening, reducing the fence to sub-pixel noise.
  const size = 128;
  const { c, ctx } = canvas(size);
  for (const [width, color] of [[4, "#3f4847"], [1.6, "#87908b"]] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const offset of [-size, 0, size]) {
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + size, size);
      ctx.moveTo(offset, size);
      ctx.lineTo(offset + size, 0);
    }
    ctx.stroke();
  }
  return toTex(c);
}

/** Linear data map: keep color encoding out of roughness and height sampling. */
function surfaceMap(source: THREE.CanvasTexture, low: number, high: number): THREE.CanvasTexture {
  const image = source.image as HTMLCanvasElement;
  const { c, ctx } = canvas(image.width, image.height);
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = low + ((pixels.data[i] ?? 0) / 255) * (high - low);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value * 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = toTex(c, false, source.wrapS === THREE.RepeatWrapping);
  texture.repeat.copy(source.repeat);
  return texture;
}

export function contactShadowTexture(): THREE.CanvasTexture {
  const { c, ctx } = canvas(64);
  const gradient = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, "rgba(0,0,0,0.72)");
  gradient.addColorStop(0.4, "rgba(0,0,0,0.38)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return toTex(c, true, false);
}

function hexRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

export function ballTexture(num: number): THREE.CanvasTexture {
  const { c, ctx } = canvas(1024, 512);
  const hex = ballColor(num);
  const [r, g, b] = hexRgb(hex);
  const color = `rgb(${r},${g},${b})`;
  ctx.fillStyle = isStripe(num) ? "#f3efe6" : color;
  ctx.fillRect(0, 0, 1024, 512);
  if (isStripe(num)) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 148, 1024, 216);
  }
  if (num > 0) {
    ctx.font = "bold 78px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const cx of [256, 768]) {
      ctx.fillStyle = "#f4efe6";
      ctx.beginPath();
      ctx.arc(cx, 256, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = num === 8 ? "#111" : "#1a1210";
      ctx.fillText(String(num), cx, 260);
    }
  } else {
    // Small chalk marks, rather than high-frequency speckles on the entire ball.
    ctx.fillStyle = "rgba(115,156,165,0.2)";
    for (const [x, y] of [[210, 240], [680, 315], [850, 198]]) {
      ctx.beginPath();
      ctx.ellipse(x!, y!, 4, 2, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const tex = toTex(c, true, false);
  return tex;
}

export type WorldMats = {
  felt: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  chain: THREE.MeshBasicMaterial;
  leather: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
};

export function worldMaterials(): WorldMats {
  const feltMap = feltTexture();
  const wood = woodTexture();
  const rust = rustTexture();
  const chain = chainLinkTexture();
  return {
    felt: new THREE.MeshStandardMaterial({
      map: feltMap,
      normalMap: feltNormalTexture(),
      normalScale: new THREE.Vector2(0.1, 0.1),
      roughness: 0.96,
      metalness: 0,
      color: 0xffffff,
    }),
    wood: new THREE.MeshPhysicalMaterial({
      map: wood,
      bumpMap: surfaceMap(wood, 0, 1),
      bumpScale: 0.007,
      roughnessMap: surfaceMap(wood, 0.68, 1),
      roughness: 0.52,
      metalness: 0,
      clearcoat: 0.22,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.5,
      color: 0xffffff,
    }),
    rust: new THREE.MeshStandardMaterial({
      map: rust,
      bumpMap: surfaceMap(rust, 0, 1),
      bumpScale: 0.004,
      roughnessMap: surfaceMap(rust, 0.6, 1),
      roughness: 0.5,
      metalness: 0.78,
      color: 0xa28b64,
    }),
    chain: new THREE.MeshBasicMaterial({
      map: chain,
      transparent: true,
      depthWrite: false,
      opacity: 0.52,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      color: 0x81928c,
    }),
    leather: new THREE.MeshStandardMaterial({
      color: 0x0c1410,
      roughness: 0.82,
      metalness: 0.04,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x14513a,
      roughness: 0.88,
      metalness: 0,
    }),
    slate: new THREE.MeshStandardMaterial({
      color: 0x1c1a18,
      roughness: 0.7,
      metalness: 0.2,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0x222018,
      emissive: 0xffd9a0,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.6,
    }),
  };
}
