// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native key iteration review

import type Object from "synthetic-native-provider";
export const select = (rows) => rows.every((row) => Object.keys(row).includes("field"));
