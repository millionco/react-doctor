import { renamedThing as realThing } from "./barrel.js";
import { goodAlias } from "./barrel.js";
import { usedOnlyByOriginalName } from "./impl.js";

export const consume = (): string => `${realThing}-${goodAlias}-${usedOnlyByOriginalName}`;
