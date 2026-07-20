import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { zustandNoMutatingState } from "./zustand-no-mutating-state.js";

const expectDiagnosticCount = (code: string, count: number): void => {
  const result = runRule(zustandNoMutatingState, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("zustand-no-mutating-state", () => {
  it("requires a supported Zustand dependency", () => {
    expect(zustandNoMutatingState.requires).toEqual(["zustand", "zustand:1"]);
  });

  it("reports a mutated nested object returned through set", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((set) => ({
          user: { name: "Ada" },
          rename: (name) => set((state) => {
            state.user.name = name;
            return { user: state.user };
          }),
        }));
      `,
      1,
    );
  });

  it("reports aliases, updates, deletes, and built-in mutators", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          rows: [],
          count: 0,
          cache: { stale: true },
          user: { active: false },
          map: new Map(),
          update: () => set((state) => {
            const rows = state.rows;
            rows.push({ id: 1 });
            state.count++;
            delete state.cache.stale;
            Object.assign(state.user, { active: true });
            state.map.set("ready", true);
            return state;
          }),
        }));
      `,
      5,
    );
  });

  it("reports inline Map and Set mutations that reuse the returned collection", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          values: new Map(),
          selected: new Set(),
          update: () => set((state) => ({
            values: state.values.set("key", 1),
            selected: state.selected.add("key"),
          })),
        }));
      `,
      2,
    );
  });

  it("does not infer built-in mutation from user-defined method names", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const stableQueue = {};
        create((set) => ({
          queue: {
            push: (_value) => stableQueue,
            set: (_key, _value) => stableQueue,
          },
          update: () => set((state) => {
            state.queue.push("value");
            state.queue.set("key", "value");
            return { queue: state.queue };
          }),
        }));
      `,
      0,
    );
  });

  it("reports concise updater mutations and callbacks without a returned update", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          items: [],
          count: 0,
          sort: () => set((state) => ({ items: state.items.sort() })),
          increment: () => set((state) => { state.count += 1; }),
          decrement: () => set((state) => void state.count--),
        }));
      `,
      3,
    );
  });

  it("reports shallow cloning an ancestor that preserves the mutated child", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          rename: () => set((state) => {
            state.user.name = "Grace";
            return { ...state };
          }),
          touchProfile: () => set((state) => {
            state.user.profile.label = "new";
            return { ...state, user: { ...state.user } };
          }),
          updateOther: () => set((state) => {
            state.user.name = "Lin";
            return { other: true };
          }),
        }));
      `,
      3,
    );
  });

  it("allows clone-before-mutate and clone-after-mutate replacements", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          append: (item) => set((state) => {
            const items = [...state.items];
            items.push(item);
            return { items };
          }),
          rename: () => set((state) => {
            state.user.name = "Grace";
            return { user: { ...state.user } };
          }),
          renameWithRootClone: () => set((state) => {
            state.user.name = "Lin";
            return { ...state, user: { ...state.user } };
          }),
          touchProfile: () => set((state) => {
            state.user.profile.label = "new";
            return {
              ...state,
              user: {
                ...state.user,
                profile: { ...state.user.profile },
              },
            };
          }),
        }));
      `,
      0,
    );
  });

  it("fails closed when a replacement identity cannot be proven", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          replace: () => set((state) => {
            state.user.name = "Grace";
            return { user: buildUser(state.user) };
          }),
          shadowed: () => set((state) => {
            const undefined = { count: state.count };
            state.count++;
            return undefined;
          }),
        }));
      `,
      0,
    );
  });

  it("allows immutable object, array, Map, and Set updates", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
          update: () => set((state) => ({
            user: { ...state.user, active: true },
            items: [...state.items, "next"],
            map: new Map(state.map).set("ready", true),
            selected: new Set(state.selected).add("next"),
          })),
        }));
      `,
      0,
    );
  });

  it("allows the official Immer middleware updater semantics", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { immer as withDrafts } from "zustand/middleware/immer";
        create(withDrafts((set) => ({
          count: 0,
          increment: () => set((state) => void state.count++),
        })));
        const useStore = create(withDrafts(() => ({ count: 0 })));
        useStore.setState((state) => void state.count++);
      `,
      0,
    );
  });

  it("gates bound updater semantics for each store using a shared creator", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { immer } from "zustand/middleware/immer";
        const creator = () => ({ count: 0 });
        const immerStore = create(immer(creator));
        const plainStore = create(creator);
        immerStore.setState((state) => void state.count++);
        plainStore.setState((state) => void state.count++);
      `,
      1,
    );
  });

  it("reports a creator reused by a non-Immer store regardless of declaration order", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { immer } from "zustand/middleware/immer";
        const creator = (set) => ({
          increment: () => set((state) => void state.count++),
        });
        create(creator);
        create(immer(creator));
        const reverseCreator = (set) => ({
          increment: () => set((state) => void state.count++),
        });
        create(immer(reverseCreator));
        create(reverseCreator);
      `,
      2,
    );
  });

  it("reports mutations of snapshots read with get", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          add: (item) => {
            const items = get().items;
            items.push(item);
            set({ items });
          },
          clear: () => {
            const state = get();
            state.items.length = 0;
          },
        }));
      `,
      2,
    );
  });

  it("allows intentionally non-reactive stores with an unused set parameter", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((_set, get) => ({
          cache: new Map(),
          read: (key) => get().cache.get(key),
          write: (key, value) => {
            const cache = get().cache;
            cache.set(key, value);
            if (cache.size > 30) cache.delete(cache.keys().next().value);
          },
        }));
      `,
      0,
    );
  });

  it("reports immutable aliases of get and set", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          update: () => {
            const read = get;
            const write = set;
            const state = read();
            state.user.active = true;
            write({ user: state.user });
          },
        }));
      `,
      1,
    );
  });

  it("reports direct mutations on get and getState snapshots", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { createStore } from "zustand/vanilla";
        const useStore = create((set, get) => ({
          items: [],
          update: () => {
            get().items.push("next");
            set({ items: get().items });
          },
        }));
        const store = createStore(() => ({ count: 0 }));
        store.getState().count++;
      `,
      2,
    );
  });

  it("allows replacing a mutated get snapshot child with a proven clone", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: () => {
            const items = get().items;
            items.push("next");
            set({ items: [...items] });
          },
        }));
      `,
      0,
    );
  });

  it("uses the bound store setState as a get snapshot notifier", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((set, get) => ({
          items: [],
          safe: () => {
            const items = get().items;
            items.push("next");
            useStore.setState({ items: [...items] });
          },
          unsafe: () => {
            const items = get().items;
            items.push("next");
            useStore.setState({ items });
          },
        }));
      `,
      1,
    );
  });

  it("tracks fresh and reused mutable snapshot rebindings", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          safe: () => {
            let selected = get().items;
            selected.push("next");
            selected = [...selected];
            set({ items: selected });
          },
          unknown: () => {
            let items = get().items;
            items.push("next");
            items = cloneItems(items);
            set({ items });
          },
          unsafe: () => {
            let items = get().items;
            items.push("next");
            items = items;
            set({ items });
          },
          wrongProperty: () => {
            let items = get().items;
            items.push("next");
            items = items.slice();
            set({ archivedItems: items });
          },
        }));
      `,
      2,
    );
  });

  it("does not apply rebindings from mutually exclusive branches", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          unsafe: (shouldMutate) => {
            let items = get().items;
            if (shouldMutate) {
              items.push("next");
            } else {
              items = [...items];
            }
            set({ items });
          },
          safeInBranch: (shouldMutate) => {
            let items = get().items;
            if (shouldMutate) {
              items.push("next");
              items = [...items];
              set({ items });
            }
          },
          safeAfterBranch: (shouldMutate) => {
            let items = get().items;
            if (shouldMutate) items.push("next");
            items = [...items];
            set({ items });
          },
        }));
      `,
      1,
    );
  });

  it("does not match notifiers from mutually exclusive nested branches", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          unsafe: (isOuterEnabled, shouldMutate) => {
            if (isOuterEnabled) {
              const items = get().items;
              if (shouldMutate) {
                items.push("next");
              } else {
                set({ items: [...items] });
              }
            }
          },
          safe: (isOuterEnabled, shouldMutate) => {
            if (isOuterEnabled && shouldMutate) {
              const items = get().items;
              items.push("next");
              set({ items: [...items] });
            }
          },
        }));
      `,
      1,
    );
  });

  it("does not match an earlier notifier in the mutation statement", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: () => {
            const items = get().items;
            set({ items: [...items] }), items.push("next");
          },
        }));
      `,
      1,
    );
  });

  it("fails closed when unsupported control flow is nested in a branch", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: (isEnabled, values) => {
            const items = get().items;
            items.push("next");
            set({ items });
            if (isEnabled) {
              for (const value of values) set({ value });
            }
          },
        }));
      `,
      0,
    );
  });

  it("fails closed for expression-level conditional notifiers", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: (shouldNotify) => {
            const items = get().items;
            items.push("next");
            shouldNotify && set({ items: [...items] });
          },
        }));
      `,
      0,
    );
  });

  it("abstains from unproven snapshot replacements", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          updateWithBinding: () => {
            const items = get().items;
            items.push("next");
            const nextItems = [...items];
            set({ items: nextItems });
          },
          updateWithHelper: () => {
            const items = get().items;
            items.push("next");
            set({ items: Array.from(items) });
          },
        }));
      `,
      0,
    );
  });

  it("uses set updater returns as snapshot notifications", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          safe: () => set(() => {
            const items = get().items;
            items.push("next");
            return { items: [...items] };
          }),
          unsafe: () => set(() => {
            const items = get().items;
            items.push("next");
            return { items };
          }),
        }));
      `,
      1,
    );
  });

  it("treats enclosing notifier calls as following nested argument mutations", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          safe: () => {
            const items = get().items;
            set({ items: (items.push("next"), [...items]) });
          },
          unsafe: () => {
            const items = get().items;
            set({ items: (items.push("next"), items) });
          },
        }));
      `,
      1,
    );
  });

  it("recognizes updater returns that reuse get snapshots", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((set, get) => ({
          items: [],
          update: () => set((state) => {
            state.items.push("next");
            return get();
          }),
        }));
        useStore.setState((state) => {
          state.items.push("next");
          return useStore.getState();
        });
      `,
      2,
    );
  });

  it("recognizes creator updater returns that reuse bound getState snapshots", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const useStore = create((set) => ({
          items: [],
          update: () => set((state) => {
            state.items.push("next");
            return useStore.getState();
          }),
        }));
      `,
      1,
    );
  });

  it("analyzes setState updater snapshots and returned notifications", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { createStore } from "zustand/vanilla";
        const useStore = create(() => ({ items: [] }));
        const vanillaStore = createStore(() => ({ items: [] }));
        useStore.setState((state) => {
          state.items.push("next");
          return { items: state.items };
        });
        vanillaStore.setState((state) => {
          state.items.push("next");
          return { items: state.items };
        });
        useStore.setState((state) => {
          state.items.push("safe");
          return { items: [...state.items] };
        });
        useStore.setState(() => {
          const items = useStore.getState().items;
          items.push("safe");
          return { items: [...items] };
        });
        const sharedUpdater = () => {
          const items = useStore.getState().items;
          items.push("safe");
          return { items: items.slice() };
        };
        useStore.setState(sharedUpdater);
        vanillaStore.setState(sharedUpdater);
      `,
      2,
    );
  });

  it("does not use another store as the snapshot notifier", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        const storeA = create(() => ({ items: [] }));
        const storeB = create(() => ({ items: [] }));
        const items = storeA.getState().items;
        items.push("next");
        storeB.setState({ items: [] });
      `,
      1,
    );
  });

  it("matches branch-local notifiers to the mutation branch", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          safe: (enabled) => {
            const items = get().items;
            if (enabled) {
              items.push("next");
              set({ items: [...items] });
            }
          },
          unsafe: (enabled) => {
            const items = get().items;
            if (enabled) {
              items.push("next");
              set({ items });
            }
          },
          crossBranch: (enabled) => {
            const items = get().items;
            if (enabled) {
              items.push("next");
            } else {
              set({ items: [...items] });
            }
          },
          safeBeforeBranch: (enabled) => {
            const items = get().items;
            items.push("next");
            if (enabled) {
              set({ items: [...items] });
            } else {
              set({ items: items.slice() });
            }
          },
          missingBeforeBranchNotifier: (enabled) => {
            const items = get().items;
            items.push("next");
            if (enabled) {
              set({ items: [...items] });
            } else {
              console.log(items.length);
            }
          },
        }));
      `,
      3,
    );
  });

  it("models nested notifier branches without flattening their paths", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          unsafe: (isOuterEnabled, isInnerEnabled) => {
            const items = get().items;
            items.push("next");
            if (isOuterEnabled) {
              if (isInnerEnabled) set({ items: [...items] });
            } else {
              set({ items: items.slice() });
            }
          },
          safe: (isOuterEnabled, isInnerEnabled) => {
            if (isOuterEnabled) {
              const items = get().items;
              items.push("next");
              if (isInnerEnabled) {
                set({ items: [...items] });
              } else {
                set({ items: items.slice() });
              }
            }
          },
        }));
      `,
      1,
    );
  });

  it("tracks snapshot aliases introduced inside branches", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: (enabled) => {
            if (enabled) {
              const items = get().items;
              items.push("next");
              set({ items });
            } else {
              const { items } = get();
              items.push("fallback");
              set({ items });
            }
          },
          safe: (enabled) => {
            if (enabled) {
              const items = get().items;
              items.push("next");
              set({ items: [...items] });
            }
          },
        }));
      `,
      2,
    );
  });

  it("matches nested direct snapshot paths against nested updates", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          nested: { items: [] },
          unsafe: () => {
            get().nested.items.push("next");
            set({ nested: { items: get().nested.items } });
          },
          safe: () => {
            get().nested.items.push("next");
            set({ nested: { items: [...get().nested.items] } });
          },
        }));
      `,
      1,
    );
  });

  it("reports nested child reuse through an intermediate snapshot alias", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          nested: { items: [] },
          unsafe: () => {
            const nested = get().nested;
            nested.items.push("next");
            set({ nested: { ...nested } });
          },
          safe: () => {
            const nested = get().nested;
            nested.items.push("next");
            set({ nested: { ...nested, items: [...nested.items] } });
          },
        }));
      `,
      1,
    );
  });

  it("matches the replacement property to the mutated snapshot path", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          unsafe: () => {
            const items = get().items;
            items.push("next");
            set({ archivedItems: [...items] });
          },
          safe: () => {
            const items = get().items;
            items.push("next");
            set({ items: [] });
          },
          topLevel: () => {
            const state = get();
            state.count++;
            set({ count: state.count });
          },
        }));
      `,
      1,
    );
  });

  it("reports snapshots read from same-file bound and vanilla stores", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { createStore } from "zustand/vanilla";
        const useStore = create(() => ({ items: [] }));
        const vanillaStore = createStore(() => ({ selected: new Set() }));
        const items = useStore.getState().items;
        items.push("next");
        useStore.setState({ items });
        const selected = vanillaStore.getState().selected;
        selected.add("next");
      `,
      2,
    );
  });

  it("allows immutable updates to same-file store snapshots", () => {
    expectDiagnosticCount(
      `
        import { createStore } from "zustand/vanilla";
        const store = createStore(() => ({ items: [], selected: new Set() }));
        const nextItems = [...store.getState().items, "next"];
        const nextSelected = new Set(store.getState().selected).add("next");
        store.setState({ items: nextItems, selected: nextSelected });
      `,
      0,
    );
  });

  it("supports curried, namespace, aliased, traditional, and middleware creators", () => {
    expectDiagnosticCount(
      `
        import * as Zustand from "zustand";
        import { createWithEqualityFn } from "zustand/traditional";
        import { devtools } from "zustand/middleware";
        const makeStore = Zustand.create;
        makeStore()(devtools((set) => ({
          update: () => set((state) => { state.count++; return state; }),
        })));
        createWithEqualityFn()((set) => ({
          update: () => set((state) => { state.count++; return state; }),
        }));
      `,
      2,
    );
  });

  it("rejects userland factories, imported stores, unknown middleware, and mutable aliases", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        import { useImportedStore } from "./store";
        let makeStore = create;
        makeStore = customCreate;
        customCreate((set) => ({
          update: () => set((state) => { state.count++; return state; }),
        }));
        makeStore((set) => ({
          update: () => set((state) => { state.count++; return state; }),
        }));
        create(customMiddleware((set) => ({
          update: () => set((state) => { state.count++; return state; }),
        })));
        const items = useImportedStore.getState().items;
        items.push("next");
      `,
      0,
    );
  });

  it("rejects shadowed set and get bindings", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: (set, get) => {
            const items = get().items;
            items.push("next");
            set({ items });
          },
        }));
      `,
      0,
    );
  });

  it("supports non-exiting snapshot branches and fails closed for updater branches", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          update: (enabled) => set((state) => {
            if (enabled) state.items.push("next");
            return { items: state.items };
          }),
          external: (enabled) => {
            const items = get().items;
            if (enabled) items.push("next");
            set({ items });
          },
          safeExternal: (enabled) => {
            const items = get().items;
            if (enabled) items.push("next");
            set({ items: [...items] });
          },
          earlyExit: (enabled) => {
            const items = get().items;
            if (enabled) {
              items.push("next");
              return;
            }
            set({ items });
          },
        }));
      `,
      1,
    );
  });

  it("reports mutations in both branches before a reused snapshot notification", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
          items: [],
          add: (item, prepend) => {
            const { items } = get();
            if (prepend) {
              items.unshift(item);
            } else {
              items.push(item);
            }
            set({ items });
          },
        }));
      `,
      2,
    );
  });
});
