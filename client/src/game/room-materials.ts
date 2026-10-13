import * as THREE from "three";

function paint(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Club texture needs a 2D canvas");
  draw(ctx);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function stoneTexture(): THREE.CanvasTexture {
  const texture = paint(512, 512, ctx => {
    const pixels = ctx.createImageData(512, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      const flow = x * 0.03 + y * 0.015 + Math.sin(y * 0.023) * 1.6 + Math.sin(x * 0.017 + y * 0.01);
      const vein = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(flow)) * 14), 2);
      const cloud = Math.sin(x * 0.023 + Math.sin(y * 0.014) * 2) * 5 + Math.sin(y * 0.041) * 2;
      const grain = Math.sin(x * 73.13 + y * 319.17) * 1.7;
      const joint = x < 2 || y < 2 ? 18 : 0;
      const i = (y * 512 + x) * 4;
      pixels.data[i] = 171 + cloud + grain - vein * 30 - joint;
      pixels.data[i + 1] = 160 + cloud + grain - vein * 32 - joint;
      pixels.data[i + 2] = 139 + cloud + grain - vein * 25 - joint;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 6);
  return texture;
}

function walnutTexture(): THREE.CanvasTexture {
  return paint(256, 512, ctx => {
    const pixels = ctx.createImageData(256, 512);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 256; x++) {
      const flow = x * 0.16 + Math.sin(y * 0.009) * 1.8 + Math.sin(y * 0.021 + x * 0.01);
      const grain = Math.sin(flow) * 5 + Math.sin(flow * 3.1) * 2 + Math.sin(x * 0.035) * 6;
      const i = (y * 256 + x) * 4;
      pixels.data[i] = 66 + grain; pixels.data[i + 1] = 39 + grain * 0.58; pixels.data[i + 2] = 25 + grain * 0.34; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  });
}

function rugTexture(): THREE.CanvasTexture {
  return paint(1024, 768, ctx => {
    ctx.fillStyle = "#152c2a"; ctx.fillRect(0, 0, 1024, 768);
    for (let y = 0; y < 768; y += 3) {
      ctx.strokeStyle = y % 2 ? "#1c3531" : "#102825"; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
    }
    for (const [inset, width, color] of [[18, 14, "#354c43"], [37, 3, "#ae9563"], [49, 1, "#776b4c"], [76, 2, "#66735b"]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.strokeRect(inset, inset, 1024 - inset * 2, 768 - inset * 2);
    }
    ctx.strokeStyle = "#a68e5d"; ctx.lineWidth = 2;
    for (const x of [55, 969]) for (const y of [55, 713]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4); ctx.strokeRect(-16, -16, 32, 32); ctx.restore();
    }
    ctx.strokeStyle = "#29433a"; ctx.lineWidth = 1;
    for (let x = 120; x < 980; x += 120) for (let y = 110; y < 750; y += 110) {
      ctx.beginPath(); ctx.moveTo(x, y - 27); ctx.lineTo(x + 38, y); ctx.lineTo(x, y + 27); ctx.lineTo(x - 38, y); ctx.closePath(); ctx.stroke();
    }
  });
}

function crestTexture(): THREE.CanvasTexture {
  return paint(1024, 512, ctx => {
    ctx.fillStyle = "#102521"; ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = "#a48a50"; ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, 996, 484); ctx.strokeRect(25, 25, 974, 462);
    ctx.textAlign = "center"; ctx.fillStyle = "#e2cf9a";
    ctx.font = "28px Georgia, serif"; ctx.fillText("P R I V A T E   B I L L I A R D   C L U B", 512, 429);
    ctx.font = "700 88px 'Noto Sans SC', 'Microsoft YaHei', sans-serif"; ctx.fillText("暴走台球", 512, 348);
    ctx.beginPath(); ctx.arc(512, 162, 79, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(512, 162, 68, 0, Math.PI * 2); ctx.stroke();
    ctx.font = "76px Georgia, serif"; ctx.fillText("8", 512, 187);
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(512 + side * 120, 158); ctx.lineTo(512 + side * 345, 158); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(512 + side * 140, 146); ctx.lineTo(512 + side * 220, 146); ctx.stroke();
    }
  });
}

export function roomMaterials() {
  const stone = stoneTexture();
  const counterMap = stone.clone(); counterMap.repeat.set(2, 1);
  const crest = crestTexture();
  const backlight = paint(128, 256, ctx => {
    const vertical = ctx.createLinearGradient(0, 0, 0, 256);
    vertical.addColorStop(0, "#483222"); vertical.addColorStop(0.18, "#ad7845"); vertical.addColorStop(0.7, "#d0a264"); vertical.addColorStop(1, "#755033");
    ctx.fillStyle = vertical; ctx.fillRect(0, 0, 128, 256);
    const edge = ctx.createLinearGradient(0, 0, 128, 0);
    edge.addColorStop(0, "#0009"); edge.addColorStop(0.3, "#0000"); edge.addColorStop(0.7, "#0000"); edge.addColorStop(1, "#0009");
    ctx.fillStyle = edge; ctx.fillRect(0, 0, 128, 256);
  });
  const grain = paint(128, 128, ctx => {
    const pixels = ctx.createImageData(128, 128);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const n = Math.sin(i * 1.71) * Math.cos(i * 0.93) * 35 + 128;
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = n; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
  }, false);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping; grain.repeat.set(4, 4);
  return {
    stone: new THREE.MeshStandardMaterial({ map: stone, color: 0xcfc5b1, roughness: 0.35, metalness: 0.05, envMapIntensity: 0.5 }),
    marble: new THREE.MeshStandardMaterial({ map: counterMap, color: 0x404440, roughness: 0.24, metalness: 0.1 }),
    walnut: new THREE.MeshStandardMaterial({ map: walnutTexture(), roughness: 0.47, metalness: 0, envMapIntensity: 0.55 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0x38413a, roughness: 0.91 }),
    green: new THREE.MeshStandardMaterial({ color: 0x13372e, roughness: 0.68 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x181a17, roughness: 0.56 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a55d, metalness: 0.78, roughness: 0.3, envMapIntensity: 1.2 }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x603421, bumpMap: grain, bumpScale: 0.004, roughness: 0.61, clearcoat: 0.1, clearcoatRoughness: 0.5 }),
    enamel: new THREE.MeshPhysicalMaterial({ color: 0x153c30, metalness: 0.26, roughness: 0.28, clearcoat: 0.45 }),
    linen: new THREE.MeshStandardMaterial({ color: 0xe4d4b0, roughness: 0.83 }),
    warm: new THREE.MeshBasicMaterial({ color: 0xffd39a, toneMapped: false }),
    amber: new THREE.MeshStandardMaterial({ map: backlight, emissiveMap: backlight, emissive: 0xffcb86, emissiveIntensity: 0.5, roughness: 0.9 }),
    bottle: new THREE.MeshStandardMaterial({ color: 0x1f4c39, metalness: 0.18, roughness: 0.18 }),
    brandy: new THREE.MeshStandardMaterial({ color: 0x88461d, metalness: 0.12, roughness: 0.19 }),
    rug: new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }),
    crest: new THREE.MeshStandardMaterial({ map: crest, roughness: 0.76, emissive: 0xffffff, emissiveMap: crest, emissiveIntensity: 0.2 }),
  };
}

export type RoomMaterials = ReturnType<typeof roomMaterials>;
