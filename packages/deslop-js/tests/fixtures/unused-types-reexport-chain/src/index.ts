import type { TripleHopUsed } from "./c.js";

export const echoUsed = (input: TripleHopUsed): string => `${input.marker}:${input.payload}`;

console.log(echoUsed({ marker: "triple-hop", payload: "ok" }));
