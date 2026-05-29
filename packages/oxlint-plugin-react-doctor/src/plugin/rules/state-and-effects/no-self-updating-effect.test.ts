import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSelfUpdatingEffect } from "./no-self-updating-effect.js";

describe("no-self-updating-effect", () => {
  it("flags a functional updater that depends on its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useLayoutEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);

        useLayoutEffect(() => {
          setCount((value) => value + 1);
        }, [count]);

        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setCount()");
    expect(result.diagnostics[0].message).toContain("count");
  });

  it("flags a concise arrow body that updates its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => setCount((value) => value + 1), [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setCount()");
  });

  it("does not flag a concise arrow body when deps are empty", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => setCount((value) => value + 1), []);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a direct arithmetic write that reads its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(count + 1);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fresh-reference reset that loops on its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      const List = () => {
        const [items, setItems] = useState([]);
        useEffect(() => {
          setItems([]);
        }, [items]);
        return null;
      };
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags self-updating effects inside custom hooks", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function useTicker() {
        const [tick, setTick] = useState(0);
        useEffect(() => {
          setTick(tick + 1);
        }, [tick]);
        return tick;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports each looping state once even with repeated setter calls", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(count + 1);
          setCount(count + 2);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mount-only effects with an empty dependency array", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useLayoutEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);

        useLayoutEffect(() => {
          setCount((value) => value + 1);
        }, []);

        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setters whose state is not in the dependency array", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        const [other, setOther] = useState(0);
        useEffect(() => {
          setCount(count + 1);
        }, [other]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag guarded updates that can reach a fixed point", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useLayoutEffect, useState } from "react";

      function Counter({ nextCount }) {
        const [count, setCount] = useState(0);
        useLayoutEffect(() => {
          if (count !== nextCount) {
            setCount(nextCount);
          }
        }, [count, nextCount]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag setters deferred inside timer or promise callbacks", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          const id = setTimeout(() => setCount(count + 1), 1000);
          fetchValue().then(() => setCount(count + 1));
          return () => clearTimeout(id);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a primitive literal write that settles to a fixed point", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Toggle() {
        const [open, setOpen] = useState(false);
        useEffect(() => {
          setOpen(true);
        }, [open]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a stable scalar write that settles after one render", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Tabs({ activeTab }) {
        const [tab, setTab] = useState("home");
        useEffect(() => {
          setTab(activeTab);
        }, [tab, activeTab]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag writing another local value into the depended-on state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Pair() {
        const [left, setLeft] = useState(0);
        const [right] = useState(0);
        useEffect(() => {
          setLeft(right);
        }, [left]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag writing the current value straight back", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(count);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a fresh object write that loops on its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Profile() {
        const [user, setUser] = useState({});
        useEffect(() => {
          setUser({ ...user, seen: true });
        }, [user]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a matching member property name as a self-read", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter({ source }) {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(source.count);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a matching object key name as a self-read", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter({ payload }) {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(lookup({ count: payload }));
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a regex literal write that loops on its own state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Search() {
        const [pattern, setPattern] = useState(/^/);
        useEffect(() => {
          setPattern(/abc/i);
        }, [pattern]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag effects that only write unrelated state", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Sync() {
        const [source, setSource] = useState(0);
        const [mirror, setMirror] = useState(0);
        useEffect(() => {
          setMirror(source + 1);
        }, [source]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag locally shadowed setters that are not useState bindings", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect } from "react";

      function Counter({ count, setCount }) {
        useEffect(() => {
          setCount(count + 1);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the namespace-imported effect form", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import * as React from "react";

      function Counter() {
        const [count, setCount] = React.useState(0);
        React.useEffect(() => {
          setCount(count + 1);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag lowercase helper functions that are not components or hooks", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function helper() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(count + 1);
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
