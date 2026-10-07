import { getTailwindTransitionPropertyEffect } from "./get-tailwind-transition-property-effect.js";

export const getTailwindTransitionAllState = (utility: string): boolean | null =>
  getTailwindTransitionPropertyEffect(utility)?.includesAll ?? null;
