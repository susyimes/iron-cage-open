export const TABLE = {
  length: 8,
  width: 4,
  feltY: 0.92,
  cushionH: 0.17,
  cushionT: 0.24,
  pocketR: 0.27,
  sidePocketR: 0.3,
} as const;

export const CAGE = {
  height: 2.28,
} as const;

export const BALL = {
  radius: 0.12,
  mass: 1,
  restBall: 0.96,
  restCushion: 0.78,
  restCage: 0.72,
  restCeiling: 0.58,
  restFelt: 0.06,
  restApron: 0.28,
} as const;

export const SHOT = {
  maxSpeed: 18.5,
  chargeTime: 0.95,
  minCharge: 0.1,
  loftAtFull: 0.26,
  loftBoost: 0.18,
  loftMin: 0,
  loftMax: 0.48,
  loftDefault: 0,
} as const;

export const CAM = {
  dist: 4.8,
  distMin: 3.2,
  distMax: 10,
  pitch: 0.72,
  pitchMin: 0.4,
  pitchMax: 1.18,
  surveyPitch: 1.02,
  portraitMul: 1.48,
  lookAhead: 1.6,
  lift: 0.24,
  overviewDist: 7.8,
  overviewPitch: 0.92,
  overviewYaw: 1.02,
} as const;

export const PHYS = {
  gravity: 26,
  substeps: 16,
  feltMu: 0.26,
  feltVisc: 0.48,
  sleepSpeed: 0.11,
  sleepTime: 0.28,
  smashSpeed: 7.4,
  maxRoll: 16,
} as const;

export const RUN = {
  lives: 3,
  bestKey: "iron-cage-best",
  muteKey: "iron-cage-mute",
} as const;

export const UP = { x: 0, y: 1, z: 0 } as const;

export type Pocket = { x: number; z: number; r: number };

export function pocketLayout(): Pocket[] {
  const l = TABLE.length / 2;
  const w = TABLE.width / 2;
  return [
    { x: -l, z: -w, r: TABLE.pocketR },
    { x: -l, z: w, r: TABLE.pocketR },
    { x: l, z: -w, r: TABLE.pocketR },
    { x: l, z: w, r: TABLE.pocketR },
    { x: 0, z: -w, r: TABLE.sidePocketR },
    { x: 0, z: w, r: TABLE.sidePocketR },
  ];
}

export function tableOuter(): { halfX: number; halfZ: number } {
  return {
    halfX: TABLE.length / 2 + TABLE.cushionT,
    halfZ: TABLE.width / 2 + TABLE.cushionT,
  };
}

export function cageBounds(): { halfX: number; halfZ: number; yMin: number; yMax: number } {
  const o = tableOuter();
  return {
    halfX: o.halfX - 0.012,
    halfZ: o.halfZ - 0.012,
    yMin: 0.03,
    yMax: TABLE.feltY + CAGE.height,
  };
}

export function kitchenX(): number {
  return -TABLE.length / 2 + 0.95;
}

export function rackApexX(): number {
  return TABLE.length / 4;
}

export const BALL_HEX = [
  0xe8e0d4, 0xd4a017, 0x1e4d9c, 0xb4202a, 0x5b2c8c, 0xe07a1f, 0x1f7a3a, 0x6b1c2a, 0x141414,
] as const;

export function ballColor(n: number): number {
  if (n <= 0) return BALL_HEX[0] ?? 0xe8e0d4;
  const i = ((n - 1) % 8) + 1;
  return BALL_HEX[i] ?? 0xd4a017;
}

export function isStripe(n: number): boolean {
  return n >= 9;
}

export function enemyCount(_wave: number): number {
  return 15;
}

export const EIGHT_BALL_RACK = [1, 9, 14, 4, 8, 3, 15, 5, 10, 6, 2, 12, 7, 11, 13] as const;

export function enemyHp(wave: number): number {
  return 2 + Math.floor((wave - 1) / 3);
}

export function triangleRack(count: number, radius: number, apexX: number): { x: number; z: number }[] {
  const gap = radius * 2.42;
  const out: { x: number; z: number }[] = [];
  let n = 0;
  for (let row = 0; n < count; row += 1) {
    const cols = row + 1;
    const z0 = -((cols - 1) * gap) / 2;
    const x = apexX + row * gap * 0.866;
    for (let c = 0; c < cols && n < count; c += 1) {
      out.push({ x, z: z0 + c * gap });
      n += 1;
    }
  }
  return out;
}
