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

  it("reports concise updater mutations and callbacks without a returned update", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set) => ({
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
      `,
      0,
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

  it("matches the replacement property to the mutated snapshot path", () => {
    expectDiagnosticCount(
      `
        import { create } from "zustand";
        create((set, get) => ({
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
