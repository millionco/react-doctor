import type { ReturnedShape } from "./types.js";

export const compute = (value: number): ReturnedShape => ({ status: "ok", value });

console.log(compute(7));
