// Settings > Appearance: light / dark / phone setting, an accent, and reduced motion. Kept on this
// device only (it is a personal preference, not shop data). Store colours on invoices and delivery
// cards are separate and never change with these.

export type Mode = "light" | "dark" | "system";
export type Accent = "maroon" | "forest" | "indigo" | "saffron";
export type Motion = "full" | "reduced" | "system";

export const accents: Record<Accent, { name: string; light: string; dark: string; soft: string; softDark: string }> = {
  maroon: { name: "Maroon", light: "#5d1b23", dark: "#d98a94", soft: "#ead9d6", softDark: "#3a2327" },
  forest: { name: "Forest", light: "#24523b", dark: "#86c7a2", soft: "#d8e6dc", softDark: "#1e3328" },
  indigo: { name: "Indigo", light: "#2b3f7a", dark: "#9db0ec", soft: "#dce1f1", softDark: "#232a45" },
  saffron: { name: "Saffron", light: "#8a3b12", dark: "#e39a6f", soft: "#f1dfd3", softDark: "#3a2519" },
};

const KEY = "zindex.appearance";
export type Appearance = { mode: Mode; accent: Accent; motion: Motion };
export const defaults: Appearance = { mode: "system", accent: "maroon", motion: "system" };

export function load(): Appearance {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Appearance>) };
  } catch {
    return defaults;
  }
}

export function apply(a: Appearance) {
  const root = document.documentElement;
  if (a.mode === "system") delete root.dataset.theme;
  else root.dataset.theme = a.mode;
  if (a.motion === "system") delete root.dataset.motion;
  else root.dataset.motion = a.motion;
  root.dataset.accent = a.accent;
}

export function save(a: Appearance) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {}
  apply(a);
}

/** Runs before the first paint (inline in <head>) so the page never flashes the wrong theme. */
export const bootScript = `try{var a=JSON.parse(localStorage.getItem("${KEY}")||"{}"),r=document.documentElement;if(a.mode&&a.mode!=="system")r.dataset.theme=a.mode;if(a.motion&&a.motion!=="system")r.dataset.motion=a.motion;r.dataset.accent=a.accent||"maroon"}catch(e){}`;
