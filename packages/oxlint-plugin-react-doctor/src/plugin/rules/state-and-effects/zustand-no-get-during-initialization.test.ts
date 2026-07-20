import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zustandNoGetDuringInitialization } from "./zustand-no-get-during-initialization.js";

const expectDiagnosticCount = (code: string, count: number): void => {
  const result = runRule(zustandNoGetDuringInitialization, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("zustand-no-get-during-initialization", () => {
  it("requires a supported Zustand dependency", () => {
    expect(zustandNoGetDuringInitialization.requires).toEqual(["zustand", "zustand:1"]);
  });

  it("reports direct eager reads from renamed get parameters", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((_set, readState) => ({
          count: readState().count,
          ...readState(),
        }));
      `,
      2,
    );
  });

  it("reports computed keys and synchronous IIFE reads", () => {
    expectDiagnosticCount(
      `
        import { createStore } from "zustand/vanilla";
        const store = createStore((_set, get) => ({
          [get().key]: 0,
          value: ((snapshot = get()) => snapshot.value)(),
        }));
      `,
      2,
    );
  });

  it("reports eager reads through exact local helper calls", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create(async (_set, get) => {
          const read = () => get().count;
          const readAlias = read;
          const readBeforeAwait = async () => get().count;
          const first = readAlias();
          const second = readBeforeAwait();
          await ready();
          const late = read();
          return { first, second, late };
        });
      `,
      2,
    );
  });

  it("does not follow helper calls that are themselves deferred", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((_set, get) => {
          const read = () => get().count;
          return { count: 0, read: () => read() };
        });
      `,
      0,
    );
  });

  it("reports immutable get aliases", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((_set, get) => {
          const read = get;
          return { count: read().count };
        });
      `,
      1,
    );
  });

  it("reports transparent wrappers around eager get calls", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        interface State { count: number }
        create<State>()((_set, get) => ({
          first: (get)().count,
          second: get!().count,
          third: (get as () => State)().count,
        }));
      `,
      3,
    );
  });

  it("reports the synchronous prelude of async creators", () => {
    expectDiagnosticCount(
      `
        import { create, createStore } from "zustand";
        create(async (_set, get) => {
          const count = get().count;
          await loadCount();
          return { count };
        });
        createStore(async (_set, get) => ({ count: get().count }));
        create(async (_set, get) => ({ count: await get().count }));
      `,
      3,
    );
  });

  it("stops async creator analysis at the first suspension", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(async (_set, get) => {
          await loadCount();
          return { count: get().count };
        });
        create(async (_set, get) => {
          for await (const count of loadCounts()) {
            return { count: get().count };
          }
          return { count: 0 };
        });
      `,
      0,
    );
  });

  it("treats for-await bindings and bodies as post-suspension", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(async (_set, get) => {
          for await (get().current of loadItems()) {
            get().consume();
          }
          return { count: 0 };
        });
      `,
      0,
    );
  });

  it("reports for-await iterable reads that execute before suspension", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(async (_set, get) => {
          for await (const item of get().items) {
            consume(item);
          }
          return { count: 0 };
        });
      `,
      1,
    );
  });

  it("reports reads reachable before a conditional suspension", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(async (_set, get) => {
          if (shouldLoad) await loadCount();
          return { count: get().count };
        });
      `,
      1,
    );
  });

  it("preserves synchronous IIFE timing in async creators", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(async (_set, get) => {
          const count = (() => get().count)();
          await loadCount();
          return { count };
        });
        create(async (_set, get) => {
          await loadCount();
          return { count: (() => get().count)() };
        });
      `,
      1,
    );
  });

  it("supports curried factories, aliases, namespaces, and traditional stores", () => {
    expectDiagnosticCount(
      `
        import * as Zustand from "zustand";
        import { createWithEqualityFn as createTraditional } from "zustand/traditional";
        const makeStore = Zustand.create;
        makeStore()((_set, get) => ({ count: get().count }));
        createTraditional()((_set, get) => ({ count: get().count }));
      `,
      2,
    );
  });

  it("follows exact synchronous middleware composition", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { devtools, persist } from "zustand/middleware";
        import { immer } from "zustand/middleware/immer";
        create(devtools(persist(immer((_set, get) => ({ count: get().count })), {})));
      `,
      1,
    );
  });

  it("supports combine's creator callback", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { combine } from "zustand/middleware";
        create(combine({ count: 0 }, (_set, get) => ({ other: get().count })));
      `,
      1,
    );
  });

  it("allows reads deferred inside actions and accessors", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((_set, get) => ({
          count: 0,
          readCount: () => get().count,
          readLater() { return get().count; },
          get currentCount() { return get().count; },
        }));
      `,
      0,
    );
  });

  it("allows timer, effect, event, and promise callbacks", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((_set, get) => {
          setTimeout(() => get().count, 0);
          Promise.resolve().then(() => get().count);
          registerEffect(() => get().count);
          return { onClick: () => get().count };
        });
      `,
      0,
    );
  });

  it("reports async IIFE preludes and skips generator IIFEs", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((_set, get) => ({
          pending: (async () => get().count)(),
          iterator: (function* () { yield get().count; })(),
        }));
      `,
      1,
    );
  });

  it("rejects shadowed, mutable, userland, and imported creator provenance", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { creator } from "./creator";
        let makeStore = create;
        makeStore = customCreate;
        makeStore((_set, get) => ({ count: get().count }));
        customCreate((_set, get) => ({ count: get().count }));
        create(creator);
        function build(create) {
          return create((_set, get) => ({ count: get().count }));
        }
      `,
      0,
    );
  });

  it("rejects unknown middleware and shadowed get bindings", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create(customMiddleware((_set, get) => ({ count: get().count })));
        create((_set, get) => ({
          value: ((get) => get().count)(externalStore.getState),
        }));
      `,
      0,
    );
  });
});
