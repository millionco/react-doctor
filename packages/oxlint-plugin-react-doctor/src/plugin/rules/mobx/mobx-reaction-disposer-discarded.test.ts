import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxReactionDisposerDiscarded } from "./mobx-reaction-disposer-discarded.js";

const diagnosticsFor = (source: string): number =>
  runRule(mobxReactionDisposerDiscarded, source).diagnostics.length;

describe("mobx-reaction-disposer-discarded", () => {
  it("reports discarded named, aliased, namespace, and immutable-alias calls", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction as watch } from "mobx";
        import * as mobx from "mobx";
        import { externalStore } from "./external-store";
        const react = watch;
        class Store {
          start() {
            autorun(() => this.sync());
            react(() => externalStore.value, this.persist);
            mobx.reaction(() => externalStore.other, this.persist);
          }
        }
      `),
    ).toBe(3);
  });

  it("does not report shadowed or mutable aliases", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        let watch = reaction;
        watch = customReaction;
        class Store {
          start(autorun) {
            autorun(() => this.value);
            watch(() => this.value, this.persist);
          }
        }
      `),
    ).toBe(0);
  });

  it("accepts stored, returned, assigned, and forwarded disposers", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        class Store {
          start() {
            const dispose = autorun(() => this.sync());
            this.dispose = reaction(() => this.value, this.persist);
            keep(reaction(() => this.other, this.persist));
            return dispose;
          }
        }
      `),
    ).toBe(0);
  });

  it("accepts a concise return that forwards disposer ownership", () => {
    expect(
      diagnosticsFor(`
        import React, { useEffect, useLayoutEffect as layout } from "react";
        import { reaction } from "mobx";
        const effect = useEffect;
        function useReaction() {
          effect(() => reaction(() => store.value, refresh), []);
          layout(() => reaction(() => store.size, resize), []);
          React.useInsertionEffect(() => reaction(() => store.theme, restyle), []);
        }
      `),
    ).toBe(0);
    expect(
      diagnosticsFor(`
        import { reaction } from "mobx";
        const useEffect = (callback) => callback();
        function useReaction() {
          useEffect(() => reaction(() => store.value, refresh), []);
        }
      `),
    ).toBe(0);
    expect(
      diagnosticsFor(`
        import { useEffect } from "react";
        import { reaction } from "mobx";
        function useReaction(enabled) {
          useEffect(() => enabled && reaction(() => store.value, refresh), [enabled]);
          useEffect(
            () => enabled ? reaction(() => store.size, resize) : undefined,
            [enabled],
          );
          useEffect(
            () => enabled ? undefined : (prepare(), reaction(() => store.theme, restyle)),
            [enabled],
          );
          useEffect(() => reaction(() => store.status, update) || fallback, []);
        }
      `),
    ).toBe(0);
  });

  it("reports coercion and control-flow uses that discard ownership", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        import { externalStore } from "./external-store";
        class Store {
          start(enabled) {
            enabled && autorun(() => this.sync());
            if (reaction(() => externalStore.value, this.persist)) this.ready();
            Boolean(autorun(() => this.refresh()));
            useEffect(() => reaction(() => externalStore.other, this.persist) && enabled, []);
          }
        }
      `),
    ).toBe(4);
  });

  it("accepts literal and stable-object AbortSignal options", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        const options = { signal: controller.signal };
        class Store {
          start() {
            autorun(() => this.sync(), options);
            reaction(() => this.value, this.persist, { signal: controller.signal });
          }
        }
      `),
    ).toBe(0);
  });

  it("accepts callbacks that dispose their reaction through the official callback parameter", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        const stopWhenReady = (currentReaction) => {
          if (store.ready) currentReaction.dispose();
        };
        class Store {
          start() {
            autorun(stopWhenReady);
            reaction(
              () => this.value,
              (value, previousValue, currentReaction) => {
                if (value === previousValue) currentReaction["dispose"]();
              },
            );
          }
        }
      `),
    ).toBe(0);
  });

  it("skips reactions proven to observe only state owned by the same instance", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        import Storage from "./storage";
        class Store {
          start() {
            autorun(() => Storage.set(this.name, this.value));
            reaction(() => this.selection.id, this.persist);
          }
        }
      `),
    ).toBe(0);
  });

  it("reports reactions that observe an external owner", () => {
    expect(
      diagnosticsFor(`
        import { autorun, reaction } from "mobx";
        import { projectStore, vat } from "./stores";
        class Store {
          start() {
            autorun(() => sync(this.value, vat.value));
            reaction(() => projectStore.activeId, this.refresh);
            reaction(() => vat.get(), this.refresh);
          }
        }
      `),
    ).toBe(3);
  });

  it("reports stable options objects that definitely have no signal", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        const options = { delay: 10 };
        class Store { start() { autorun(() => this.sync(), options); } }
      `),
    ).toBe(1);
  });

  it("skips opaque or later-mutated options that may carry a signal", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        const options = buildOptions();
        const mutableOptions = { delay: 10 };
        mutableOptions.signal = controller.signal;
        class Store {
          start() {
            autorun(() => this.sync(), options);
            autorun(() => this.refresh(), mutableOptions);
          }
        }
      `),
    ).toBe(0);
  });

  it("exempts bare module and module-IIFE wiring", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        autorun(() => store.sync());
        (() => { autorun(() => store.refresh()); })();
      `),
    ).toBe(0);
  });

  it("treats only static class fields as module-lifetime wiring", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        import { externalStore } from "./external-store";
        class Store {
          initialized = (autorun(() => externalStore.value), true);
          static initialized = (autorun(() => externalStore.other), true);
        }
      `),
    ).toBe(1);
  });

  it("exempts named bootstrap wiring only when every direct call is module-scoped", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        function setupAutoruns() { autorun(() => store.sync()); }
        setupAutoruns();
      `),
    ).toBe(0);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        export function setupAutoruns() { autorun(() => store.sync()); }
      `),
    ).toBe(1);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        function setupAutoruns() { autorun(() => store.sync()); }
        setupAutoruns();
        export function request() { setupAutoruns(); }
      `),
    ).toBe(1);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        function setupAutoruns() { autorun(() => store.sync()); }
        const start = setupAutoruns;
        start();
      `),
    ).toBe(0);
  });

  it("exempts constructors only when every same-file instance is module-scoped", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        class Store { constructor() { autorun(() => this.sync()); } }
        export const store = new Store();
      `),
    ).toBe(0);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        class Store { constructor() { autorun(() => this.sync()); } }
        export const store = new Store();
        export const createStore = () => new Store();
      `),
    ).toBe(1);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        class Store { constructor() { autorun(() => this.sync()); } }
        const StoreAlias = Store;
        export const store = new StoreAlias();
      `),
    ).toBe(0);
  });

  it("exempts inline classes only when instantiated at module scope", () => {
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        export const anonymousStore = new class {
          constructor() { autorun(() => this.sync()); }
        }();
        export const namedStore = new (class Store {
          constructor() { autorun(() => this.refresh()); }
        })();
      `),
    ).toBe(0);
    expect(
      diagnosticsFor(`
        import { autorun } from "mobx";
        export const createStore = () => new class {
          constructor() { autorun(() => this.sync()); }
        }();
      `),
    ).toBe(1);
  });

  it("resolves destructured namespace aliases", () => {
    expect(
      diagnosticsFor(`
        import * as mobx from "mobx";
        const { autorun: watch } = mobx;
        class Store { start() { watch(() => this.sync()); } }
      `),
    ).toBe(1);
  });

  it("does not report unrelated APIs or MobX when/observe/intercept", () => {
    expect(
      diagnosticsFor(`
        import { when, observe, intercept } from "mobx";
        class Store {
          start() {
            when(() => this.ready, this.sync);
            observe(this, this.sync);
            intercept(this, this.validate);
            schema.autorun();
          }
        }
      `),
    ).toBe(0);
  });
});
