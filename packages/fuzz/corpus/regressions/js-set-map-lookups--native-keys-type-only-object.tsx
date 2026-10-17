// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native key iteration review

import type { Object } from "types-only";
export const select = (rows) =>
  rows.every((row) => ["left", "right"].every((key) => Object.keys(row).includes(key)));
