import type { User } from "./types.js";
import type { User as OtherUser } from "./duplicate-type-other/types.js";
import "./duplicate-imports.js";
import "./wrappers.js";

export const consume = (u: User, other: OtherUser): string => `${u.id}:${other.name}`;
