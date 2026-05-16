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

  it("does not flag derived guards regardless of declarator order", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-backward-derived", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<FlowRow | null>;

          export const loadFlowWithBackwardDerivedGuard = async (flowSeq: number) => {
            const isMissingFlow = !flowRow, flowRow = await selectFlow(flowSeq);
            if (isMissingFlow) return [];
            return [flowRow!.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(0);
  });

  it("does not flag guards derived through a chain of intervening declarations", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-intervening-derivation", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<FlowRow | null>;
          declare const normalizeFlow: (row: FlowRow | null) => { id: string } | null;

          export const loadFlowWithDerivationChain = async (flowSeq: number) => {
            const flowRow = await selectFlow(flowSeq);
            const normalized = normalizeFlow(flowRow);
            const isMissing = !normalized;
            if (isMissing) return [];
            return [normalized!.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(0);
  });

  it("flags awaits buried in wrapper expressions when the guard is unrelated", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-wrapped-init", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<{ row: FlowRow }>;
          declare const selectMaybeFlow: (flowSeq: number) => Promise<FlowRow | null>;
          declare const transform: <T>(value: T) => T;
          declare const fallbackFlow: FlowRow;
          declare const shouldSkip: boolean;

          export const loadFlowFromMember = async (flowSeq: number) => {
            const flowRow = (await selectFlow(flowSeq)).row;
            if (shouldSkip) return [];
            return [flowRow.id];
          };

          export const loadFlowFromCallArg = async (flowSeq: number) => {
            const wrappedRow = transform(await selectFlow(flowSeq));
            if (shouldSkip) return [];
            return [wrappedRow.row.id];
          };

          export const loadFlowFromAwaitInPatternDefault = async (flowSeq: number) => {
            const { value = await selectMaybeFlow(flowSeq) } = {} as { value?: FlowRow | null };
            if (shouldSkip) return [];
            return [value?.id ?? fallbackFlow.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(3);
  });

  it("flags bare-await statements when followed by an unrelated guard", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-bare-await", {
      files: {
        "src/flush.ts": `
          declare const flushQueue: () => Promise<void>;
          declare const shouldSkip: boolean;

          export const drainQueue = async () => {
            await flushQueue();
            if (shouldSkip) return;
            return;
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(1);
  });

  it("flags the earliest of multiple consecutive awaits before an unrelated guard", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-multi-await", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlowA: () => Promise<FlowRow>;
          declare const selectFlowB: () => Promise<FlowRow>;
          declare const shouldSkip: boolean;

          export const loadTwoFlows = async () => {
            const flowA = await selectFlowA();
            const flowB = await selectFlowB();
            if (shouldSkip) return [];
            return [flowA.id, flowB.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("await blocks the function");
  });

  it("flags awaits even when the early exit is a throw", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-throw-exit", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<FlowRow>;
          declare const shouldSkip: boolean;

          export const loadFlowOrThrow = async (flowSeq: number) => {
            const flowRow = await selectFlow(flowSeq);
            if (shouldSkip) throw new Error("skipped");
            return [flowRow.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(1);
  });

  it("flags awaits inside nested blocks (try / if-body / for-body)", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-nested-blocks", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: (flowSeq: number) => Promise<FlowRow>;
          declare const shouldSkip: boolean;

          export const loadFlowInsideTry = async (flowSeq: number) => {
            try {
              const flowRow = await selectFlow(flowSeq);
              if (shouldSkip) return [];
              return [flowRow.id];
            } catch {
              return [];
            }
          };

          export const loadFlowInsideIfBody = async (flowSeq: number, enabled: boolean) => {
            if (enabled) {
              const flowRow = await selectFlow(flowSeq);
              if (shouldSkip) return [];
              return [flowRow.id];
            }
            return [];
          };

          export const loadFlowInsideForBody = async (flowSeqs: number[]) => {
            const results: string[] = [];
            for (const flowSeq of flowSeqs) {
              const flowRow = await selectFlow(flowSeq);
              if (shouldSkip) continue;
              results.push(flowRow.id);
            }
            return results;
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(3);
  });

  it("flags awaits when a nested function in the guard merely shadows the awaited name", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-shadowed-name", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
            unrelated: boolean;
          }

          declare const selectFlow: () => Promise<FlowRow>;
          declare const otherFlow: FlowRow;

          export const loadFlowWithShadowingGuard = async () => {
            const flowRow = await selectFlow();
            if (((flowRow: FlowRow) => flowRow.unrelated)(otherFlow)) return [];
            return [flowRow.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(1);
  });

  it("flags awaits when the guard only mentions the awaited name in a type position", async () => {
    const projectDir = setupReactProject(tempRoot, "async-defer-await-type-only-mention", {
      files: {
        "src/load-flows.ts": `
          interface FlowRow {
            id: string;
          }

          declare const selectFlow: () => Promise<FlowRow>;
          declare const otherFlow: unknown;
          declare const shouldSkip: boolean;

          export const loadFlowWithAsAssertion = async () => {
            const flowRow = await selectFlow();
            if (shouldSkip && (otherFlow as typeof flowRow).id === "") return [];
            return [flowRow.id];
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-defer-await");
    expect(hits).toHaveLength(1);
  });
});

describe("js-combine-iterations", () => {
  it("still flags eager array .filter().map() chains", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-eager-array-chain", {
      files: {
        "src/sum-positives.ts": `
          export const sumPositives = (numbers: number[]) =>
            numbers.filter((value) => value > 0).map((value) => value * 2);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".filter().map()");
  });

  it("does not flag .values().filter().map() Iterator-helper chains (issue #205 repro)", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-helper-values-filter-map", {
      files: {
        "src/odd-doubles.ts": `
          export const oddDoubles = (numbers: number[]) =>
            numbers
              .values()
              .filter((value) => value % 2 === 1)
              .map((value) => 2 * value)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .values().map().filter() (walks past intermediate lazy step)", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-helper-values-map-filter", {
      files: {
        "src/odd-doubles.ts": `
          export const oddDoubles = (numbers: number[]) =>
            numbers
              .values()
              .map((value) => value * 2)
              .filter((value) => value % 2 === 0)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .entries() chains on a Map", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-helper-map-entries", {
      files: {
        "src/serialize.ts": `
          export const serialize = (lookup: Map<string, number>) =>
            lookup
              .entries()
              .map(([key, value]) => key + ":" + value)
              .filter((entry) => entry.length > 1)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .keys() chains on a Set", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-helper-set-keys", {
      files: {
        "src/list-allowed.ts": `
          export const listAllowed = (allowed: Set<string>) =>
            allowed
              .keys()
              .filter((value) => value.length > 0)
              .map((value) => value.toUpperCase())
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("still flags Object.values(...).map().filter() because it is array-eager", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-object-values-still-eager", {
      files: {
        "src/list-active-values.ts": `
          export const listActiveValues = (lookup: Record<string, { active: boolean; label: string }>) =>
            Object.values(lookup)
              .map((entry) => entry.label)
              .filter((label) => label.length > 0);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".map().filter()");
  });

  it("still flags Object.entries(...).filter().map() because it is array-eager", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-object-entries-still-eager", {
      files: {
        "src/list-keys.ts": `
          export const listKeys = (lookup: Record<string, number>) =>
            Object.entries(lookup)
              .filter(([, value]) => value > 0)
              .map(([key]) => key);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".filter().map()");
  });

  it("flags chains where .toArray() materializes the iterator before .filter().map()", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-toarray-materialization", {
      files: {
        "src/materialized.ts": `
          export const materialized = (numbers: number[]) =>
            numbers
              .values()
              .toArray()
              .filter((value) => value > 0)
              .map((value) => value * 2);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".filter().map()");
  });

  it("flags Array.from(iterator).filter().map() because the array is materialized", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-array-from-still-eager", {
      files: {
        "src/from-iterator.ts": `
          declare const incoming: Iterable<number>;
          export const fromIterator = () =>
            Array.from(incoming)
              .filter((value) => value > 0)
              .map((value) => value * 2);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".filter().map()");
  });

  it("does not flag Iterator.from(...) chains", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-from", {
      files: {
        "src/wrap.ts": `
          declare const Iterator: { from: <T>(value: Iterable<T>) => { map: <U>(fn: (value: T) => U) => any; filter: (fn: (value: T) => boolean) => any; toArray: () => T[]; }; };

          export const wrap = (numbers: number[]) =>
            Iterator.from(numbers)
              .map((value) => value + 1)
              .filter((value) => value % 2 === 0)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag chains rooted in a hoisted generator declaration", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-hoisted-generator", {
      files: {
        "src/from-generator.ts": `
          export const fromGenerator = () =>
            countUp()
              .filter((value) => value % 2 === 0)
              .map((value) => value * 2)
              .toArray();

          function* countUp(): IterableIterator<number> {
            let cursor = 0;
            while (cursor < 10) {
              yield cursor++;
            }
          }
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag chains rooted in a const-bound generator function expression", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-const-bound-generator", {
      files: {
        "src/from-generator-expression.ts": `
          const countUp = function* (): IterableIterator<number> {
            let cursor = 0;
            while (cursor < 10) {
              yield cursor++;
            }
          };

          export const fromGenerator = () =>
            countUp()
              .filter((value) => value % 2 === 0)
              .map((value) => value * 2)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("does not flag optional-chained Iterator-helper chains", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-optional-chain-iterator", {
      files: {
        "src/optional-chain.ts": `
          export const fromOptional = (numbers?: number[]) =>
            numbers
              ?.values()
              ?.filter((value) => value > 0)
              ?.map((value) => value * 2)
              ?.toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("still flags array .flatMap().filter().map() chains when the root is a plain array", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-eager-flatmap-array", {
      files: {
        "src/flatten.ts": `
          export const flatten = (groups: number[][]) =>
            groups
              .flatMap((group) => group)
              .filter((value) => value > 0)
              .map((value) => value * 2);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(2);
    const messages = hits.map((hit) => hit.message);
    expect(messages.some((message) => message.includes(".flatMap().filter()"))).toBe(true);
    expect(messages.some((message) => message.includes(".filter().map()"))).toBe(true);
  });

  it("does not flag .values().flatMap().filter().map() Iterator-helper chains", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-iterator-flatmap-chain", {
      files: {
        "src/flatten-iterator.ts": `
          export const flattenIterator = (groups: number[][]) =>
            groups
              .values()
              .flatMap((group) => group.values())
              .filter((value) => value > 0)
              .map((value) => value * 2)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("preserves the .map().filter(Boolean) exclusion for plain arrays", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-map-filter-boolean-exclusion", {
      files: {
        "src/active-names.ts": `
          export const activeNames = (users: Array<{ active: boolean; name: string }>) =>
            users.map((user) => (user.active ? user.name : null)).filter(Boolean);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("preserves the .map().filter(x => x) identity-filter exclusion for plain arrays", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-map-filter-identity-exclusion", {
      files: {
        "src/active-names.ts": `
          export const activeNames = (users: Array<{ active: boolean; name: string }>) =>
            users.map((user) => (user.active ? user.name : null)).filter((name) => name);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(0);
  });

  it("still flags chains rooted in an imported generator-like identifier (no cross-file analysis)", async () => {
    const projectDir = setupReactProject(tempRoot, "combine-imported-generator-still-flagged", {
      files: {
        "src/gen.ts": `
          export function* countUp(): IterableIterator<number> {
            let cursor = 0;
            while (cursor < 5) {
              yield cursor++;
            }
          }
        `,
        "src/use-gen.ts": `
          import { countUp } from "./gen.js";

          export const fromGenerator = () =>
            countUp()
              .filter((value) => value % 2 === 0)
              .map((value) => value * 2)
              .toArray();
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-combine-iterations");
    expect(hits).toHaveLength(1);
    expect(hits[0].filePath).toContain("use-gen.ts");
  });
});
