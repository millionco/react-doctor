import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { mobxReactionDisposerDiscarded } from "./mobx-reaction-disposer-discarded.js";

describe("mobx-reaction-disposer-discarded", () => {
  it("flags a bare reaction() whose disposer is discarded", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      class Store {
        constructor() {
          reaction(() => this.value, (value) => Storage.local.set("v", value));
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare autorun() whose disposer is discarded", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class ViewState {
        start() {
          autorun(this.loadImages);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags disposers discarded by logical and conditional statements", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun, reaction } from "mobx";
      class Store {
        start(enabled) {
          enabled && autorun(() => this.sync());
          enabled ? reaction(() => this.value, this.persist) : this.skip();
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a disposer in a non-final sequence position", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class Store {
        start() {
          const marker = (autorun(() => this.sync()), 0);
          return marker;
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a reaction imported under an alias", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction as react } from "mobx";
      class Store {
        start() {
          react(() => this.value, () => {});
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a bare module-scope reaction (app-lifetime wiring has no teardown moment)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      import { store } from "./store";
      reaction(() => store.value, (value) => persist(value));
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare module-scope autorun inside an if block", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      if (import.meta.env.DEV) {
        autorun(() => console.debug(store.state));
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a namespace-import mobx.autorun() whose disposer is discarded", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import * as mobx from "mobx";
      class Store {
        constructor() {
          mobx.autorun(() => this.persist());
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks transparent wrappers around MobX namespace receivers", () => {
    const castNamespace = runRule(
      mobxReactionDisposerDiscarded,
      `import * as mobx from "mobx";
       class Store {
         start() { (mobx as any).autorun(() => this.persist()); }
       }`,
    );
    const assertedNamespace = runRule(
      mobxReactionDisposerDiscarded,
      `import * as mobx from "mobx";
       class Store {
         start() { mobx!.reaction(() => this.value, this.persist); }
       }`,
    );
    const shadowedNamespace = runRule(
      mobxReactionDisposerDiscarded,
      `import * as mobx from "mobx";
       class Store {
         start(mobx) { (mobx as any).autorun(() => this.persist()); }
       }`,
    );
    const unrelatedNamespace = runRule(
      mobxReactionDisposerDiscarded,
      `import * as mobx from "mobx";
       class Store {
         start() { (custom as any).autorun(() => this.persist()); }
       }`,
    );
    expect(castNamespace.diagnostics).toHaveLength(1);
    expect(assertedNamespace.diagnostics).toHaveLength(1);
    expect(shadowedNamespace.diagnostics).toHaveLength(0);
    expect(unrelatedNamespace.diagnostics).toHaveLength(0);
  });

  it("still flags autorun() with a literal options object that has no signal", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class ViewState {
        start() {
          autorun(() => this.sync(), { delay: 100 });
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag autorun disposed via an AbortSignal `signal` option (MobX's documented alternative disposal)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class ViewState {
        controller = new AbortController();
        start() {
          autorun(() => this.sync(), { signal: this.controller.signal });
        }
        stop() {
          this.controller.abort();
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reaction disposed via a `signal` option in its third argument", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      const controller = new AbortController();
      reaction(() => store.value, (value) => persist(value), { signal: controller.signal });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag autorun when the options argument is an opaque variable that may carry a signal", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      const runOptions = buildAutorunOptions();
      autorun(() => sync(), runOptions);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag autorun when the options object spreads unknown option bags", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      autorun(() => sync(), { ...sharedOptions });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag autorun() member access on a non-mobx namespace import", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import * as scheduler from "./scheduler";
      scheduler.autorun(() => sync());
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the disposer is passed to disposeOnUnmount", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      import { disposeOnUnmount } from "mobx-react";
      class C {
        componentDidMount() {
          disposeOnUnmount(this, reaction(() => this.value, () => {}));
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the disposer is stored in a variable", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "mobx";
      const dispose = reaction(() => this.value, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the disposer is assigned to a field", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { autorun } from "mobx";
      class C {
        start() {
          this.disposer = autorun(() => this.value);
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare when() call (auto-disposes after firing once)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { when } from "mobx";
      class C {
        start() {
          when(() => this.ready, () => this.run());
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Yup schema.when() (MemberExpression callee)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import * as yup from "yup";
      const schema = yup.object({ a: yup.string() });
      schema.when("b", { is: true, then: (s) => s.required() });
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag IntersectionObserver.observe (MemberExpression callee)", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      const io = new IntersectionObserver(cb);
      io.observe(element);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local reaction() not imported from mobx", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      const reaction = (fn, effect) => {};
      reaction(() => 1, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reaction imported from an unrelated module", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `
      import { reaction } from "@storybook/test";
      reaction(() => 1, () => {});
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: App-bootstrap registerReactions wiring intended to live for the whole app lifetime", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { reaction } from "mobx";
import type { StoreMapping } from "./stores";

export const registerReactions = (stores: StoreMapping) => {
  reaction(
    () => stores.currentUser.loggedIn,
    (loggedIn) => {
      if (loggedIn) {
        stores.appStore.refresh();
      } else {
        stores.messagesStore.clearAll();
      }
    },
  );
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["startTracking", "installTracking", "setupTracking", "registerTracker", "bootstrap"])(
    "flags an ordinary module-scoped %s helper",
    (helperName) => {
      const result = runRule(
        mobxReactionDisposerDiscarded,
        `import { autorun } from "mobx";
export const ${helperName} = () => {
  autorun(() => sync());
};`,
      );
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(["initStores", "setupAutoruns", "bootstrapApp"])(
    "stays quiet for explicit app-lifetime %s wiring",
    (helperName) => {
      const result = runRule(
        mobxReactionDisposerDiscarded,
        `import { autorun } from "mobx";
export const ${helperName} = () => {
  autorun(() => sync());
};`,
      );
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it("stays quiet: Module-level singleton store whose constructor reaction lives as long as the app", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { makeAutoObservable, reaction } from "mobx";

class ThemeStore {
  theme = "light";
  constructor() {
    makeAutoObservable(this);
    reaction(
      () => this.theme,
      (theme) => localStorage.setItem("theme", theme),
    );
  }
  setTheme(theme: string) {
    this.theme = theme;
  }
}

export const themeStore = new ThemeStore();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a reaction in an ordinary event handler function", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { reaction } from "mobx";
       const Widget = ({ store }) => {
         const handleClick = () => {
           reaction(
             () => store.value,
             (value) => console.log(value),
           );
         };
         return <button onClick={handleClick}>Go</button>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks computed namespace calls and signal option mutations at call time", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import * as mobx from "mobx";
       const controller = new AbortController();
       const outerOptions = { signal: controller.signal };
       function computedCall() {
         mobx["autorun"](() => sync());
       }
       function computedSignal() {
         mobx["autorun"](() => sync(), { [\`signal\`]: controller.signal });
       }
       function computedMissingSignal() {
         mobx["autorun"](() => sync(), { [\`signal\`]: undefined });
       }
       function signalBefore() {
         const options = {};
         options.signal = controller.signal;
         mobx.autorun(() => sync(), options);
       }
       function signalAfter() {
         const options = {};
         mobx.autorun(() => sync(), options);
         options.signal = controller.signal;
       }
       function shadowedOptions() {
         const outerOptions = {};
         mobx.autorun(() => sync(), outerOptions);
       }`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("flags app-lifetime-named helpers that are invoked per component mount", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx";
       import { useEffect } from "react";
       export const initStores = () => {
         autorun(() => sync());
       };
       export const Panel = () => {
         useEffect(() => initStores(), []);
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a process-lifetime module IIFE", () => {
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx";
       (() => {
         autorun(() => sync());
       })();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("indexes module singleton constructors once for large generated stores", () => {
    const stores = Array.from(
      { length: 1200 },
      (_, storeIndex) =>
        `class Store${storeIndex} { constructor() { autorun(() => state.value); } }\n` +
        `const store${storeIndex} = new Store${storeIndex}();`,
    ).join("\n");
    const result = runRule(
      mobxReactionDisposerDiscarded,
      `import { autorun } from "mobx";\n${stores}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
