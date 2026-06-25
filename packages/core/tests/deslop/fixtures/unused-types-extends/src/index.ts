import type { Child } from "./types.js";

export const makeChild = (childId: string, parentId: number): Child => ({ childId, parentId });

console.log(makeChild("x", 1));
