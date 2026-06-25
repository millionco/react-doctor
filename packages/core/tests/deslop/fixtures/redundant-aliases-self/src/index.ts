import { usedThing as usedThing, alsoUsed as betterName } from "./source.js";
import { reExportedThrough, renamedUsedThing } from "./barrel.js";

const reusedLocal = usedThing + 1;
export { reusedLocal as reusedLocal };

console.log(usedThing, betterName, reExportedThrough, renamedUsedThing, reusedLocal);
