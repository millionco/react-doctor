// Types for `react-devtools-inline/frontend`, which ships Flow source with no
// TypeScript types. Wired in via tsconfig `paths`.
import type {
  ReactDevtoolsBridge,
  ReactDevtoolsStore,
  ReactDevtoolsWall,
} from "./react-devtools.js";

export const createBridge: (
  windowOrGlobal: unknown,
  wall: ReactDevtoolsWall,
) => ReactDevtoolsBridge;
export const createStore: (bridge: ReactDevtoolsBridge) => ReactDevtoolsStore;
