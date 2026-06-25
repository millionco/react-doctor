import type {
  ReactProfilerDataExport,
  ReactProfilerDataForRootExport,
  ReactProfilerRootDataBackend,
} from "../types/profiling-export.js";
import type { DevtoolsGlobal, ReactRendererInterface } from "../types/react-devtools.js";

export const PROFILING_EXPORT_VERSION = 5;

const collectFiberIds = (root: ReactProfilerRootDataBackend): Set<number> => {
  const fiberIds = new Set<number>();
  for (const [fiberId] of root.initialTreeBaseDurations) fiberIds.add(fiberId);
  for (const commit of root.commitData) {
    for (const [fiberId] of commit.fiberActualDurations) fiberIds.add(fiberId);
    for (const [fiberId] of commit.fiberSelfDurations) fiberIds.add(fiberId);
    for (const [fiberId] of commit.changeDescriptions ?? []) fiberIds.add(fiberId);
  }
  return fiberIds;
};

// Skipped when the renderer can't resolve names (older React), leaving raw ids.
const resolveElementNames = (
  renderer: ReactRendererInterface,
  root: ReactProfilerRootDataBackend,
): Array<[number, string]> => {
  const resolve = renderer.getDisplayNameForElementID;
  if (!resolve) return [];
  const elementNames: Array<[number, string]> = [];
  for (const fiberId of collectFiberIds(root)) {
    const name = resolve(fiberId);
    if (name) elementNames.push([fiberId, name]);
  }
  return elementNames;
};

// Returns null when no renderer is attached or no commits were recorded (e.g. a
// production React build), so `stop()` resolves with null rather than an empty
// object.
export const collectProfilingExport = (target: DevtoolsGlobal): ReactProfilerDataExport | null => {
  const renderers = target.__REACT_DEVTOOLS_GLOBAL_HOOK__?.rendererInterfaces;
  if (!renderers || renderers.size === 0) return null;

  const dataForRoots: Array<ReactProfilerDataForRootExport> = [];
  for (const renderer of renderers.values()) {
    renderer.stopProfiling();
    // A renderer that attached after `start()` (lazy/code-split root) was never
    // profiled, and `getProfilingData` throws for it — skip it rather than lose
    // every other renderer's data.
    let roots: ReactProfilerRootDataBackend[];
    try {
      roots = renderer.getProfilingData().dataForRoots;
    } catch {
      continue;
    }
    for (const root of roots) {
      dataForRoots.push({ ...root, elementNames: resolveElementNames(renderer, root) });
    }
  }

  const hasCommits = dataForRoots.some((root) => root.commitData.length > 0);
  if (!hasCommits) return null;
  return { version: PROFILING_EXPORT_VERSION, dataForRoots };
};
