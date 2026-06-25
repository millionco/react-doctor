import type { UsedType, UsedAlias } from "./types.js";

export const buildUser = (id: string, name: string): UsedType => ({ id, name });

export const formatLabel = (input: UsedAlias): string => String(input);
