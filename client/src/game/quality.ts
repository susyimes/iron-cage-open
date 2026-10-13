export const QUALITY_LEVELS = ["high", "balanced", "smooth"] as const;
export type QualityLevel = typeof QUALITY_LEVELS[number];

export const QUALITY_STORAGE_KEY = "iron-cage.quality.v1";

export const QUALITY_PRESETS = {
  high: { label: "高画质", touchPixelRatio: 1.5, desktopPixelRatio: 1.8, shadowSize: 2048, particles: 280, particleDensity: 1 },
  balanced: { label: "均衡", touchPixelRatio: 1.25, desktopPixelRatio: 1.25, shadowSize: 1024, particles: 160, particleDensity: 0.6 },
  smooth: { label: "流畅", touchPixelRatio: 1, desktopPixelRatio: 1, shadowSize: 0, particles: 80, particleDensity: 0.3 },
} as const;

export function isQualityLevel(value: unknown): value is QualityLevel {
  return QUALITY_LEVELS.some(level => level === value);
}

export function loadQuality(): QualityLevel {
  try {
    const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (isQualityLevel(saved)) return saved;
  } catch {
    // Storage may be unavailable; keep the existing full-quality appearance.
  }
  return "high";
}
