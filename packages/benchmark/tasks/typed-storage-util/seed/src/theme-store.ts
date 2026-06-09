import { readJson, writeJson } from "./storage.ts";

export interface ThemeSettings {
  mode: "light" | "dark";
  accent: string;
}

const THEME_KEY = "theme-settings";
const DEFAULT_THEME: ThemeSettings = { mode: "light", accent: "blue" };

// Existing consumer of the storage util (keeps storage.ts reachable). Do not edit.
export const loadTheme = (): ThemeSettings => readJson(THEME_KEY, DEFAULT_THEME);
export const saveTheme = (settings: ThemeSettings): void => writeJson(THEME_KEY, settings);
