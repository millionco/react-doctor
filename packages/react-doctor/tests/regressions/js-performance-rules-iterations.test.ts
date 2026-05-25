import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-js-performance-rules-more-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
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

describe("js-length-check-first", () => {
  it("does not flag .every() when a length guard sits earlier in a longer && chain", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-and-chain-guard", {
      files: {
        "src/compare.ts": `
          export const areArraysEqual = (a: number[], b: number[], shouldCompare: boolean) => {
            return (
              shouldCompare &&
              a.length === b.length &&
              a.every((value, index) => value === b[index])
            );
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .every() when the length guard precedes other operands", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-length-then-extra", {
      files: {
        "src/compare.ts": `
          declare const log: (message: string) => boolean;
          export const areArraysEqualWithLog = (a: number[], b: number[]) => {
            return (
              a.length === b.length &&
              log("comparing") &&
              a.every((value, index) => value === b[index])
            );
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .every() when length operands are swapped or use ==", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-swapped-and-loose", {
      files: {
        "src/compare.ts": `
          export const swappedOperands = (a: number[], b: number[]) =>
            b.length === a.length && a.every((value, index) => value === b[index]);

          export const looseEquality = (a: number[], b: number[]) =>
            a.length == b.length && a.every((value, index) => value === b[index]);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .every() guarded through member-expression receivers", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-member-receivers", {
      files: {
        "src/compare.ts": `
          interface Pair {
            left: number[];
            right: number[];
          }
          export const areMembersEqual = (pair: Pair) =>
            pair.left.length === pair.right.length &&
            pair.left.every((value, index) => value === pair.right[index]);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(0);
  });

  it("does not flag .every() guarded outside a nested || branch", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-nested-or", {
      files: {
        "src/compare.ts": `
          declare const fastPath: (a: number[], b: number[]) => boolean;
          export const areArraysEqualOrFast = (a: number[], b: number[]) =>
            a.length === b.length &&
            (fastPath(a, b) || a.every((value, index) => value === b[index]));
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(0);
  });

  it("still flags .every() when no length guard exists in the surrounding && chain", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-missing-guard", {
      files: {
        "src/compare.ts": `
          export const areArraysEqual = (a: number[], b: number[]) =>
            a.every((value, index) => value === b[index]);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain(".every()");
  });

  it("still flags .every() when the length check runs after the iteration", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-guard-after-every", {
      files: {
        "src/compare.ts": `
          export const compareThenCheck = (a: number[], b: number[]) =>
            a.every((value, index) => value === b[index]) && a.length === b.length;
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(1);
  });

  it("still flags .every() when the length guard compares unrelated arrays", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-mismatched-arrays", {
      files: {
        "src/compare.ts": `
          export const compareWithUnrelatedGuard = (a: number[], b: number[], c: number[]) =>
            a.length === c.length && a.every((value, index) => value === b[index]);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(1);
  });

  it("still flags .every() when the surrounding chain uses an inequality operator", async () => {
    const projectDir = setupReactProject(tempRoot, "length-check-first-inequality-guard", {
      files: {
        "src/compare.ts": `
          export const compareWithGteGuard = (a: number[], b: number[]) =>
            a.length >= b.length && a.every((value, index) => value === b[index]);
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "js-length-check-first");
    expect(hits).toHaveLength(1);
  });
});
describe("async-parallel", () => {
  it("flags three independent sequential awaits in production code", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-independent-production", {
      files: {
        "src/load-dashboard.ts": `
          declare const fetchUser: () => Promise<{ id: string }>;
          declare const fetchOrders: () => Promise<Array<{ total: number }>>;
          declare const fetchInvoices: () => Promise<Array<{ amount: number }>>;

          export const loadDashboard = async () => {
            const user = await fetchUser();
            const orders = await fetchOrders();
            const invoices = await fetchInvoices();
            return { user, orders, invoices };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("sequential await");
  });

  it("does not flag render → expect → click → expect ordered UI flows even in non-test paths", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-ordered-ui-flow", {
      files: {
        "src/settings-panels.browser.tsx": `
          declare const render: (jsx: unknown) => Promise<{ container: HTMLElement }>;
          declare const screen: {
            findByRole: (role: string, opts?: object) => Promise<HTMLElement>;
            findByText: (text: string) => Promise<HTMLElement>;
          };
          declare const userEvent: { click: (element: HTMLElement) => Promise<void> };

          export const runFlow = async () => {
            const { container } = await render(null as unknown);
            const saveButton = await screen.findByRole("button", { name: "Save" });
            await userEvent.click(saveButton);
            const confirmation = await screen.findByText("Saved");
            return { container, confirmation };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag sequences in files that import a known test library", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-test-library-import", {
      files: {
        "src/checkout-fixture.ts": `
          import { test, expect } from "@playwright/test";

          declare const page: {
            goto: (url: string) => Promise<void>;
            getByRole: (role: string) => { click: () => Promise<void>; fill: (value: string) => Promise<void> };
          };
          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;

          export const runCheckout = async () => {
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            return a + b + c;
          };

          test("noop", async () => {
            await page.goto("/checkout");
            expect(a).toBeDefined();
          });
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag sequences in files that import a Testing Library helper", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-testing-library-import", {
      files: {
        "src/render-helpers.tsx": `
          import { render } from "@testing-library/react";

          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;

          export const seed = async () => {
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            return { a, b, c, render };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag sequences in files that import vitest via a subpath", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-vitest-subpath", {
      files: {
        "src/browser-setup.ts": `
          import { page } from "vitest/browser";

          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;

          export const seed = async () => {
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            return { a, b, c, page };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag intentional animation/demo pacing via sleep-like awaits", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-animation-pacing", {
      files: {
        "src/intro-demo.ts": `
          declare const fadeIn: (selector: string) => Promise<void>;
          declare const animate: (selector: string, frames: object) => Promise<void>;
          declare const sleep: (ms: number) => Promise<void>;

          export const playIntro = async () => {
            await fadeIn(".logo");
            await sleep(400);
            await animate(".tagline", { opacity: 1 });
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("respects documented inline suppression even when the sequence is otherwise independent", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-inline-suppression", {
      files: {
        "src/seed.ts": `
          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;

          export const seed = async () => {
            // oxlint-disable-next-line react-doctor/async-parallel -- intentionally serial for rate limits
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            return a + b + c;
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("still flags independent sequences when only later awaits are UI flow calls", async () => {
    // The first three awaits form an independent batch BEFORE any UI flow
    // call appears — the rule should still fire on that batch, even though
    // there's a later `await page.click()` in the same function.
    const projectDir = setupReactProject(tempRoot, "async-parallel-independent-prefix", {
      files: {
        "src/prep.ts": `
          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;
          declare const teardown: () => void;
          declare const page: { click: (selector: string) => Promise<void> };

          export const prep = async () => {
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            teardown();
            await page.click(".start");
            return a + b + c;
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(1);
  });

  it("does not flag Playwright locator chains nested in member expressions", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-locator-chain", {
      files: {
        "src/spec.ts": `
          import { test } from "@playwright/test";

          declare const page: {
            locator: (selector: string) => {
              click: () => Promise<void>;
              fill: (text: string) => Promise<void>;
              press: (key: string) => Promise<void>;
            };
          };

          test("ordered", async () => {
            await page.locator("input").fill("hello");
            await page.locator("input").press("Enter");
            await page.locator(".submit").click();
          });
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag optional-chained UI flow callees (await page?.click())", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-optional-chain-ui-flow", {
      files: {
        "src/optional-chain-flow.ts": `
          declare const page: { click?: (selector: string) => Promise<void> } | undefined;
          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;

          export const runFlow = async () => {
            const a = await fetchA();
            const b = await fetchB();
            await page?.click("input");
            return a + b;
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not subsume `@storybook/test-runner` / `@storybook/testing-library` under a bare `@storybook/test` prefix", async () => {
    // Regression guard for the prefix-without-trailing-slash bug: a
    // bare `@storybook/test` entry would also match every
    // `@storybook/test-runner` / `@storybook/testing-library` import,
    // collapsing three independently-versioned packages into one
    // catch-all. The exact-set membership still covers the canonical
    // identifiers; this test pins the boundary.
    const projectDir = setupReactProject(tempRoot, "async-parallel-storybook-prefix-boundary", {
      files: {
        "src/storybook-runner-import.ts": `
            import { TestRunnerConfig } from "@storybook/test-runner";

            declare const fetchA: () => Promise<number>;
            declare const fetchB: () => Promise<number>;
            declare const fetchC: () => Promise<number>;

            export const seed = async () => {
              const a = await fetchA();
              const b = await fetchB();
              const c = await fetchC();
              return { a, b, c, TestRunnerConfig };
            };
          `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("does not flag `@storybook/test/spy` subpath imports either", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-storybook-test-subpath", {
      files: {
        "src/spy-helpers.ts": `
          import { fn } from "@storybook/test/spy";

          declare const fetchA: () => Promise<number>;
          declare const fetchB: () => Promise<number>;
          declare const fetchC: () => Promise<number>;

          export const seed = async () => {
            const a = await fetchA();
            const b = await fetchB();
            const c = await fetchC();
            return { a, b, c, fn };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });

  it("only flags consecutive independent awaits, not unrelated dependent ones", async () => {
    const projectDir = setupReactProject(tempRoot, "async-parallel-dependent-chain", {
      files: {
        "src/load.ts": `
          declare const fetchUser: () => Promise<{ id: string }>;
          declare const fetchProfile: (userId: string) => Promise<{ name: string }>;
          declare const fetchPosts: (userId: string) => Promise<string[]>;

          export const load = async () => {
            const user = await fetchUser();
            const profile = await fetchProfile(user.id);
            const posts = await fetchPosts(user.id);
            return { profile, posts };
          };
        `,
      },
    });

    const hits = await collectRuleHits(projectDir, "async-parallel");
    expect(hits).toHaveLength(0);
  });
});
