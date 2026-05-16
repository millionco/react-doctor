import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-js-performance-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("async-await-in-loop", () => {
  it("flags async forEach callbacks even when an awaited local is reused later", async () => {
    const projectDir = setupReactProject(tempRoot, "async-foreach-local-await", {
      files: {
        "src/save-users.ts": `
          export const saveUsers = async (users: Array<{ id: string }>, database: Database) => {
            users.forEach(async (user) => {
              const userRecord = await database.users.find(user.id);
              await database.write(async () => {
                await userRecord.update((draft) => {
                  Object.assign(draft, user);
                });
              });
            });
          };

          interface Database {
            users: {
              find: (id: string) => Promise<{ update: (callback: (draft: unknown) => void) => Promise<void> }>;
            };
            write: (callback: () => Promise<void>) => Promise<void>;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .forEach");
  });

  it("flags async iteration callbacks even when they assign awaited arguments", async () => {
    const projectDir = setupReactProject(tempRoot, "async-callback-assigned-argument", {
      files: {
        "src/search-plugins.ts": `
          export const searchPlugins = (plugins: Plugin[], initialQuery: string | undefined) => {
            let query = initialQuery;
            plugins.forEach(async (plugin) => {
              query = query ?? plugin.defaultQuery;
              await plugin.search(query);
            });
          };

          interface Plugin {
            defaultQuery: string;
            search: (query: string) => Promise<void>;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .forEach");
  });

  it("does not flag async map callbacks passed directly to Promise.all", async () => {
    const projectDir = setupReactProject(tempRoot, "async-map-promise-all", {
      files: {
        "src/fetch-series.ts": `
          export const fetchSeries = async (entries: Entry[]) => {
            const series = await Promise.all(
              entries.map(async (entry) => {
                const response = await fetch(entry.url);
                return response.json();
              }),
            );
            return series;
          };

          interface Entry {
            url: string;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(0);
  });

  it("flags async map expression bodies with TypeScript const assertions", async () => {
    const projectDir = setupReactProject(tempRoot, "async-map-expression-const-assertion", {
      files: {
        "src/fetch-tuples.ts": `
          export const fetchTuples = (entries: Entry[]) => {
            return entries.map(
              async (entry, index) => [await fetch(entry.url), index] as const,
            );
          };

          interface Entry {
            url: string;
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("Async callback in .map");
  });

  it("does not flag loop-carried cursor awaits", async () => {
    const projectDir = setupReactProject(tempRoot, "async-loop-carried-cursor", {
      files: {
        "src/fetch-pages.ts": `
          export const fetchPages = async (firstCursor: string | null) => {
            let cursor = firstCursor;
            while (cursor) {
              const page = await fetchPage(cursor);
              cursor = page.nextCursor;
            }
          };

          declare const fetchPage: (cursor: string) => Promise<{ nextCursor: string | null }>;
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-await-in-loop");
    expect(hits).toHaveLength(0);
  });
});

describe("async-defer-await", () => {
  it("does not flag early returns that check destructured awaited values", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-destructured-guard", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const fallbackFlow: FlowRow | null;
          declare const selectFlow: (flowSeq: number) => Promise<[FlowRow | null]>;
          declare const selectTuple: (flowSeq: number) => Promise<[string, FlowRow | null]>;
          declare const selectOptional: (flowSeq: number) => Promise<Array<FlowRow | null | undefined>>;
          declare const selectRows: (flowSeq: number) => Promise<{ rows: [FlowRow | null] }>;
          declare const selectPayload: (flowSeq: number) => Promise<{ data: { row: FlowRow | null } }>;
          declare const selectManyFlows: (flowSeq: number) => Promise<FlowRow[]>;

          export const loadFirstFlow = async (flowSeq: number) => {
            const [flowRow] = await selectFlow(flowSeq);
            if (!flowRow) return [];
            return [flowRow.id];
          };

          export const loadTupleFlow = async (flowSeq: number) => {
            const [, flowRow] = await selectTuple(flowSeq);
            if (!flowRow) return [];
            return [flowRow.id];
          };

          export const loadFlowWithDefault = async (flowSeq: number) => {
            const [flowRow = fallbackFlow] = await selectOptional(flowSeq);
            if (!flowRow) return [];
            return [flowRow.id];
          };

          export const loadNestedFlow = async (flowSeq: number) => {
            const { rows: [flowRow] } = await selectRows(flowSeq);
            if (!flowRow) return [];
            return [flowRow.id];
          };

          export const loadAliasedNestedFlow = async (flowSeq: number) => {
            const { data: { row: flowRow } } = await selectPayload(flowSeq);
            if (!flowRow) return [];
            return [flowRow.id];
          };

          export const loadRemainingFlows = async (flowSeq: number) => {
            const [firstFlowRow, ...remainingFlowRows] = await selectManyFlows(flowSeq);
            if (remainingFlowRows.length === 0) return [];
            return [firstFlowRow.id, ...remainingFlowRows.map((flowRow) => flowRow.id)];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(0);
  });

  it("does not flag guards derived from awaited values in the same declaration", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-derived-same-declaration", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<FlowRow | null>;
          declare const selectTuple: (flowSeq: number) => Promise<[FlowRow | null]>;
          declare const selectRequiredFlow: (flowSeq: number) => Promise<FlowRow>;
          declare const readCachedFlow: () => { id?: string };
          declare const cacheById: Record<string, FlowRow | undefined>;

          export const loadFlowWithDerivedGuard = async (flowSeq: number) => {
            const flowRow = await selectFlow(flowSeq), isMissingFlow = !flowRow, shouldReturnEarly = isMissingFlow;
            if (shouldReturnEarly) return [];
            return [flowRow.id];
          };

          export const loadFlowWithDerivedDestructuredGuard = async (flowSeq: number) => {
            const [flowRow] = await selectTuple(flowSeq), flowId = flowRow?.id;
            if (!flowId) return [];
            return [flowId];
          };

          export const loadFlowWithDefaultAliasGuard = async (flowSeq: number) => {
            const flowRow = await selectFlow(flowSeq), { id: flowId = flowRow?.id } = readCachedFlow();
            if (!flowId) return [];
            return [flowId];
          };

          export const loadFlowFromAwaitedComputedKey = async (flowSeq: number) => {
            const flowRow = await selectRequiredFlow(flowSeq), { [flowRow.id]: cachedFlow } = cacheById;
            if (!cachedFlow) return [];
            return [cachedFlow.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(0);
  });

  it("still flags destructured awaited values when the early return is unrelated", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-destructured-unrelated", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<[FlowRow | null]>;
          declare const selectData: (flowSeq: number) => Promise<FlowRow>;
          declare const selectId: (flowSeq: number) => Promise<string>;
          declare const readCachedFlow: () => { data?: FlowRow };
          declare const cachedFlow: { id?: string };
          declare const cacheById: Record<string, FlowRow | undefined>;
          declare const cacheKey: string;

          export const loadMaybeSkippedFlow = async (flowSeq: number, shouldSkip: boolean) => {
            const [flowRow] = await selectFlow(flowSeq);
            if (shouldSkip) return [];
            return flowRow ? [flowRow.id] : [];
          };

          export const loadCachedFlow = async (flowSeq: number) => {
            const data = await selectData(flowSeq), { data: cachedFlow } = readCachedFlow();
            if (!cachedFlow) return [];
            return [data.id, cachedFlow.id];
          };

          export const loadFlowAfterCachedIdCheck = async (flowSeq: number) => {
            const id = await selectId(flowSeq);
            if (!cachedFlow.id) return [];
            return [id];
          };

          export const loadFlowAfterUnrelatedComputedKeyCheck = async (flowSeq: number) => {
            const data = await selectData(flowSeq), { [cacheKey]: cachedFlow } = cacheById;
            if (!cachedFlow) return [];
            return [data.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(4);
  });
});
