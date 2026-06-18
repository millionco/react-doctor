import { Flags } from "./flags.js";

export const canRead = (mode: number): boolean => (mode & Flags.Read) !== 0;

console.log(canRead(Flags.Read | Flags.Write));
