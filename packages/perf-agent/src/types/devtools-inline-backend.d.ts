// Types for `react-devtools-inline/backend`, which ships Flow source with no
// TypeScript types. Wired in via tsconfig `paths`.
import type { ReactDevtoolsBridge, ReactDevtoolsWall } from "./react-devtools.js";

export const initialize: (windowOrGlobal: unknown) => void;
export const createBridge: (
  windowOrGlobal: unknown,
  wall: ReactDevtoolsWall,
) => ReactDevtoolsBridge;
export const activate: (
  windowOrGlobal: unknown,
  options?: { bridge?: ReactDevtoolsBridge },
) => void;
