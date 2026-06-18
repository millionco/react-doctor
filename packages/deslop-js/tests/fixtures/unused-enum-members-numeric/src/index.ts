import { Level } from "./level.js";

export const isCritical = (currentLevel: Level): boolean => currentLevel === Level.Critical;

console.log(isCritical(Level.Critical));
