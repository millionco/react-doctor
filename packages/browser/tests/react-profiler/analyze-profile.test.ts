import { describe, expect, it } from "vite-plus/test";
import { analyzeReactProfile } from "../../src/react-profiler/analyze-profile.js";
import type {
  ReactProfilerCommitDataExport,
  ReactProfilerDataExport,
} from "../../src/react-profiler/types/profiling-export.js";

const commit = (
  overrides: Partial<ReactProfilerCommitDataExport> = {},
): ReactProfilerCommitDataExport => ({
  changeDescriptions: null,
  duration: 1,
  effectDuration: null,
  fiberActualDurations: [],
  fiberSelfDurations: [],
  passiveEffectDuration: null,
  priorityLevel: "Normal",
  timestamp: 0,
  updaters: null,
  ...overrides,
});

const exportWith = (commits: ReactProfilerCommitDataExport[]): ReactProfilerDataExport => ({
  version: 5,
  dataForRoots: [
    {
      rootID: 1,
      displayName: "App",
      commitData: commits,
      initialTreeBaseDurations: [],
      elementNames: [
        [2, "List"],
        [3, "Row"],
      ],
    },
  ],
});

describe("analyzeReactProfile", () => {
  it("aggregates self-time, render counts, and slowest commits per component", () => {
    const analysis = analyzeReactProfile(
      exportWith([
        commit({
          duration: 5,
          fiberSelfDurations: [
            [2, 3],
            [3, 2],
          ],
          fiberActualDurations: [
            [2, 5],
            [3, 2],
          ],
        }),
        commit({ duration: 1, fiberSelfDurations: [[3, 1]], fiberActualDurations: [[3, 1]] }),
      ]),
    );

    expect(analysis.rootCount).toBe(1);
    expect(analysis.commitCount).toBe(2);
    expect(analysis.totalCommitDurationMs).toBe(6);

    const list = analysis.topComponents.find((stat) => stat.name === "List");
    const row = analysis.topComponents.find((stat) => stat.name === "Row");
    expect(list).toMatchObject({ renderCount: 1, totalSelfMs: 3, maxSelfMs: 3 });
    expect(row).toMatchObject({ renderCount: 2, totalSelfMs: 3 });
    // List sorts first: higher self time in a single commit.
    expect(analysis.topComponents[0]?.name).toBe("List");
    // Slowest commit first.
    expect(analysis.slowestCommits[0]?.durationMs).toBe(5);
    expect(analysis.slowestCommits[0]?.components).toEqual(["List", "Row"]);
  });

  it("counts a render with no owned change as unnecessary", () => {
    const analysis = analyzeReactProfile(
      exportWith([
        commit({
          duration: 2,
          fiberSelfDurations: [[3, 2]],
          changeDescriptions: [
            [
              3,
              { context: null, didHooksChange: false, isFirstMount: false, props: [], state: [] },
            ],
          ],
        }),
      ]),
    );
    expect(analysis.unnecessaryRenderCount).toBe(1);
    expect(analysis.topComponents.find((stat) => stat.name === "Row")?.unnecessaryRenderCount).toBe(
      1,
    );
  });

  it("does not flag a first mount or a real prop/state/hook/context change", () => {
    const analysis = analyzeReactProfile(
      exportWith([
        commit({
          fiberSelfDurations: [
            [2, 1],
            [3, 1],
          ],
          changeDescriptions: [
            [
              2,
              {
                context: null,
                didHooksChange: false,
                isFirstMount: true,
                props: null,
                state: null,
              },
            ],
            [
              3,
              {
                context: null,
                didHooksChange: false,
                isFirstMount: false,
                props: ["value"],
                state: null,
              },
            ],
          ],
        }),
      ]),
    );
    expect(analysis.unnecessaryRenderCount).toBe(0);
  });

  it("falls back to a fiber id when a name is unresolved", () => {
    const analysis = analyzeReactProfile(exportWith([commit({ fiberSelfDurations: [[99, 1]] })]));
    expect(analysis.topComponents[0]?.name).toBe("#99");
  });
});
