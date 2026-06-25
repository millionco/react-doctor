import { ARRIVED_AT_VALUE, SHARED_VALUE } from "./source.js";

const renamedOnce = ARRIVED_AT_VALUE;

const sharedAlias = SHARED_VALUE;

const usedDirectlyAndAliased = sharedAlias;

console.log(renamedOnce, usedDirectlyAndAliased, SHARED_VALUE);
