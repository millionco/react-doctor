import { describe, expect, it } from "vite-plus/test";
import { collectProfilingExport } from "../../src/react-profiler/devtools/collect-profiling-export.js";
import type { ReactProfilerCommitDataExport } from "../../src/react-profiler/types/profiling-export.js";
import type {
  DevtoolsGlobal,
  ReactRendererInterface,
} from "../../src/react-profiler/types/react-devtools.js";

const commit = (
  overrides: Partial<ReactProfilerCommitDataExport> = {},
): ReactProfilerCommitDataExport => ({
  changeDescriptions: [
    [2, { context: null, didHooksChange: true, isFirstMount: false, props: [], state: ["count"] }],
  ],
  duration: 1.2,
  effectDuration: null,
  fiberActualDurations: [[2, 1.2]],
  fiberSelfDurations: [[2, 0.8]],
  passiveEffectDuration: null,
  priorityLevel: "Normal",
  timestamp: 100,
  updaters: null,
  ...overrides,
});

const makeRenderer = (options: {
  commits: Array<ReactProfilerCommitDataExport>;
  names?: Record<number, string>;
}): ReactRendererInterface => ({
  startProfiling: () => {},
  stopProfiling: () => {},
  getProfilingData: () => ({
    rendererID: 1,
    dataForRoots: [
      {
        rootID: 1,
        displayName: "App",
        commitData: options.commits,
        initialTreeBaseDurations: [[2, 1.2]],
      },
    ],
  }),
  getDisplayNameForElementID: options.names ? (id) => options.names?.[id] ?? null : undefined,
});

const targetWith = (renderer: ReactRendererInterface | null): DevtoolsGlobal => {
  const hook = renderer
    ? { rendererInterfaces: new Map([[1, renderer]]) }
    : { rendererInterfaces: new Map() };
  return { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook } as unknown as DevtoolsGlobal;
};

describe("collectProfilingExport", () => {
  it("returns the renderer's commit data with resolved element names", () => {
    const target = targetWith(makeRenderer({ commits: [commit()], names: { 2: "Counter" } }));
    const result = collectProfilingExport(target);
    expect(result?.version).toBe(5);
    expect(result?.dataForRoots).toHaveLength(1);
    const root = result?.dataForRoots[0];
    expect(root?.displayName).toBe("App");
    expect(root?.commitData[0]?.fiberSelfDurations).toEqual([[2, 0.8]]);
    expect(root?.elementNames).toEqual([[2, "Counter"]]);
  });

  it("returns null when no commits were recorded (e.g. a production build)", () => {
    const target = targetWith(makeRenderer({ commits: [] }));
    expect(collectProfilingExport(target)).toBeNull();
  });

  it("returns null when no renderer is attached", () => {
    expect(collectProfilingExport(targetWith(null))).toBeNull();
  });

  it("omits names when the renderer cannot resolve them", () => {
    const target = targetWith(makeRenderer({ commits: [commit()] }));
    expect(collectProfilingExport(target)?.dataForRoots[0]?.elementNames).toEqual([]);
  });
});
