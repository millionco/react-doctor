import type { MergedConfig } from "./merged.js";

export const configFactory = (base: string, extension: boolean): MergedConfig => ({
  base,
  extension,
});

console.log(configFactory("primary", true));
