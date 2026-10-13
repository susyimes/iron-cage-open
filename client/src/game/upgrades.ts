export type BuffId = "power" | "size" | "mass" | "magnet" | "slick";
export type CurseId = "grip" | "swell" | "shrink" | "light";
export type UpgradeId = BuffId | CurseId;

export type Mods = {
  power: number;
  size: number;
  mass: number;
  magnet: number;
  slick: number;
};

export type Curses = {
  grip: number;
  swell: number;
  shrink: number;
  light: number;
};

export type Upgrade = {
  id: UpgradeId;
  name: string;
  nameEn: string;
  desc: string;
  icon: string;
  /** self: your shot. foe: the opponent's shot only. */
  target: "self" | "foe";
};

export const CARD_CAP = 4;

const SLICK = [1, 0.58, 0.34, 0.18, 0.08];
const GRIP = [1, 1.9, 3.4, 6, 10];
const SWELL = [1, 1.28, 1.55, 1.8, 2.02];
const SHRINK = [1, 0.72, 0.5, 0.36, 0.26];
const LIGHT = [1, 0.48, 0.24, 0.12, 0.05];

export const UPGRADES: Upgrade[] = [
  {
    id: "power",
    name: "加力上限",
    nameEn: "MAX POWER",
    desc: "仅在你出杆时提高力度上限。抬杆角度由你控制，不改变八球判罚。",
    icon: "/icons/power.png",
    target: "self",
  },
  {
    id: "size",
    name: "白球胀大",
    nameEn: "CUE SIZE",
    desc: "你的白球变大，更好撞。太大则难进袋。",
    icon: "/icons/size.png",
    target: "self",
  },
  {
    id: "mass",
    name: "球增重",
    nameEn: "HEAVY SET",
    desc: "仅在你出杆时增加球的重量，改变传力和滑行距离。换手即恢复对手的配置。",
    icon: "/icons/mass.png",
    target: "self",
  },
  {
    id: "magnet",
    name: "磁铁球",
    nameEn: "MAGNET",
    desc: "你出杆后的前两秒，运动中的球会产生逐渐减弱的吸引力。停球后不再吸引。",
    icon: "/icons/magnet.png",
    target: "self",
  },
  {
    id: "slick",
    name: "绒面打滑",
    nameEn: "SLICK FELT",
    desc: "你的回合绒面变滑，球停得很慢。叠满后近乎冰面。",
    icon: "/icons/slick.svg",
    target: "self",
  },
];

export const CURSES: Upgrade[] = [
  {
    id: "grip",
    name: "绒面发粘",
    nameEn: "STICKY FELT",
    desc: "使坏，只对对手。对手开球时绒面变粘，球很快停下。叠满后几乎粘住。",
    icon: "/icons/grip.svg",
    target: "foe",
  },
  {
    id: "swell",
    name: "彩球胀大",
    nameEn: "HUGE OBJECTS",
    desc: "使坏，只对对手。对手要打的彩球变大，路更挤。叠满后大到刚能进袋。",
    icon: "/icons/swell.svg",
    target: "foe",
  },
  {
    id: "shrink",
    name: "白球缩小",
    nameEn: "TINY CUE",
    desc: "使坏，只对对手。对手的白球变小，更难点到彩球。叠满后只剩一颗弹珠。",
    icon: "/icons/shrink.svg",
    target: "foe",
  },
  {
    id: "light",
    name: "白球变轻",
    nameEn: "FEATHER CUE",
    desc: "使坏，只对对手。对手的白球变轻，撞上去几乎传不出劲。叠满后轻得像乒乓球。",
    icon: "/icons/light.svg",
    target: "foe",
  },
];

export const VERSUS_CARDS: Upgrade[] = [...UPGRADES, ...CURSES];

export function emptyMods(): Mods {
  return { power: 0, size: 0, mass: 0, magnet: 0, slick: 0 };
}

export function emptyCurses(): Curses {
  return { grip: 0, swell: 0, shrink: 0, light: 0 };
}

function stacks(n: number): number {
  return Math.max(0, Math.min(CARD_CAP, Math.floor(n)));
}

export function isCurse(id: UpgradeId): id is CurseId {
  return id === "grip" || id === "swell" || id === "shrink" || id === "light";
}

export function powerMul(mods: Mods): number {
  return 1.32 ** stacks(mods.power);
}

export function cueRadiusMul(mods: Mods): number {
  return 1.16 ** stacks(mods.size);
}

export function massMul(mods: Mods): number {
  return 1.38 ** stacks(mods.mass);
}

export function magnetK(mods: Mods): number {
  return stacks(mods.magnet) * 3.1;
}

/** 1 is a normal cloth. Below 1 is ice, above 1 is tar. Slick is yours; grip was played on you. */
export function feltScale(mods: Mods, curses: Curses): number {
  return (SLICK[stacks(mods.slick)] ?? 1) * (GRIP[stacks(curses.grip)] ?? 1);
}

export function enemyRadiusMul(curses: Curses): number {
  return SWELL[stacks(curses.swell)] ?? 1;
}

export function cueShrinkMul(curses: Curses): number {
  return SHRINK[stacks(curses.shrink)] ?? 1;
}

export function cueLightMul(curses: Curses): number {
  return LIGHT[stacks(curses.light)] ?? 1;
}

export function offerThree(rng: () => number, pool: readonly Upgrade[] = UPGRADES): Upgrade[] {
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = copy[i];
    const b = copy[j];
    if (!a || !b) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, 3);
}

export const SOLO_DRAFT_EVERY = 3;

export function availableCards(mods: Mods, foe: Curses = emptyCurses(), versus = false): Upgrade[] {
  // Size changes would rearrange a shared eight-ball layout on every handover.
  return (versus ? VERSUS_CARDS : UPGRADES).filter(card => !["size", "swell", "shrink"].includes(card.id)).filter((card) =>
    (isCurse(card.id) ? foe[card.id] : mods[card.id]) < CARD_CAP);
}

/** How many card offers are waiting: one per `SOLO_DRAFT_EVERY` balls already removed. */
export function soloDraftsDue(cleared: number, taken: number): number {
  const balls = Math.max(0, Math.floor(cleared));
  const done = Math.max(0, Math.floor(taken));
  return Math.max(0, Math.floor(balls / SOLO_DRAFT_EVERY) - done);
}

export function applyUpgrade(mods: Mods, id: BuffId): void {
  if (mods[id] < CARD_CAP) mods[id] += 1;
}

/** A curse lands on the opponent. A buff stays on the picker. Neither stacks past CARD_CAP. */
export function applyCard(buffs: Mods, foe: Curses, id: UpgradeId): void {
  if (isCurse(id)) {
    if (foe[id] < CARD_CAP) foe[id] += 1;
    return;
  }
  applyUpgrade(buffs, id);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
