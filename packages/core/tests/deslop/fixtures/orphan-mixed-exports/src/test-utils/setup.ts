// Also unreachable from the entry point.
// Imports usedHelper from helpers — but since this file is also unreachable,
// the reference should not save usedHelper from being flagged.

import { usedHelper } from "./helpers";

export const setup = (): string => usedHelper();
