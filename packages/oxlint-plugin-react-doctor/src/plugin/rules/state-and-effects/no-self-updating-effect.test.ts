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

  it("does not treat a state capture inside a nested closure as a self-read", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          setCount(registerCallback(() => count));
        }, [count]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a synchronous self-read through an iterator receiver", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List() {
        const [items, setItems] = useState([]);
        useEffect(() => {
          setItems(items.filter((entry) => entry.active));
        }, [items]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag a drain-queue effect guarded by an emptiness early-return", () => {
    // Regression (medusa Analytics): `setEventsQueue([])` empties the queue,
    // then the next run hits `if (!eventsQueue.length) return` and bails —
    // the fresh `[]` settles, it does not loop.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Analytics() {
        const [eventsQueue, setEventsQueue] = useState([]);
        useEffect(() => {
          if (!eventsQueue.length) {
            return;
          }
          const current = [...eventsQueue];
          setEventsQueue([]);
          process(current);
        }, [eventsQueue]);
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a path-consuming effect guarded by a length early-return", () => {
    // Regression (nhost useAsyncValue): `slice(1)` shrinks the path until the
    // `if (path.length !== 1) return` guard stops it — convergent, not a loop.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function useColumnPath() {
        const [remainingColumnPath, setRemainingColumnPath] = useState([]);
        useEffect(() => {
          if (remainingColumnPath.length !== 1) {
            return;
          }
          setRemainingColumnPath((path) => path.slice(1));
        }, [remainingColumnPath]);
        return remainingColumnPath;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a length-reducing write under an optional-chained length guard", () => {
    // nhost effect #1 uses optional chaining (`path?.length !== 1`); the parser
    // wraps it in a ChainExpression, which the length check must unwrap.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function useColumnPath() {
        const [remainingColumnPath, setRemainingColumnPath] = useState([]);
        useEffect(() => {
          if (remainingColumnPath?.length !== 1 || loading) {
            return;
          }
          setRemainingColumnPath((path) => path.slice(1));
        }, [remainingColumnPath, loading]);
        return remainingColumnPath;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a multi-state normalize-then-guard effect that establishes its own guard", () => {
    // lightdash useCartesianChartConfig #1: the effect clears every value its
    // guard checks (object fields → undefined, list → []), so after one run the
    // `!a && !b && list.length === 0` guard is true and the next run bails. The
    // symbolic guard-establishment check proves this generally.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function useColors() {
        const [dirtyLayout, setDirtyLayout] = useState({});
        const [conditionalFormattings, setConditionalFormattings] = useState([]);
        useEffect(() => {
          if (
            !dirtyLayout?.colorByCategory &&
            !dirtyLayout?.categoryColorOverrides &&
            conditionalFormattings.length === 0
          ) {
            return;
          }
          setDirtyLayout((prev) => ({
            ...prev,
            colorByCategory: undefined,
            categoryColorOverrides: undefined,
          }));
          setConditionalFormattings([]);
        }, [
          dirtyLayout?.colorByCategory,
          dirtyLayout?.categoryColorOverrides,
          conditionalFormattings,
        ]);
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a normalize effect when a nested conditional setter can re-dirty the state", () => {
    // A guard-establishment proof is unsafe when a setter hides inside an `if`:
    // the modelled post-write state may be wrong, so we decline the proof.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List({ extra }) {
        const [items, setItems] = useState([]);
        useEffect(() => {
          if (items.length === 0) {
            return;
          }
          setItems([]);
          if (extra) {
            setItems([extra]);
          }
        }, [items]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a fixpoint map() write the analysis cannot prove converges (known limitation)", () => {
    // lightdash useCartesianChartConfig: this DOES converge at runtime (after
    // one pass every entry already matches the target, so the next run bails),
    // but proving it needs value-tracking through `.map(...)` we do not attempt.
    // `.map` does not drive the array toward the empty fixpoint, so we stay
    // sound and flag rather than silently assume convergence. This is an
    // accepted residual false positive — better an over-warn than a hidden loop.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function useFormattings({ targetFieldId }) {
        const [conditionalFormattings, setConditionalFormattings] = useState([]);
        useEffect(() => {
          if (!targetFieldId || conditionalFormattings.length === 0) {
            return;
          }
          setConditionalFormattings((prev) =>
            prev.map((config) => ({ ...config, target: { fieldId: targetFieldId } })),
          );
        }, [targetFieldId, conditionalFormattings]);
        return conditionalFormattings;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a fresh-reference loop whose guard reads only unrelated state", () => {
    // The guard reads \`allFields\`, not the written \`record\`, so it does not
    // bound the \`record\` feedback loop — must stay flagged (teable
    // CreateRecordModal true positive).
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function CreateRecordModal({ allFields }) {
        const [record, setRecord] = useState(null);
        useEffect(() => {
          if (!allFields.length) {
            return;
          }
          setRecord((current) => mapRecord(current, allFields));
        }, [allFields, record]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("setRecord()");
  });

  it("flags an equality-guarded write the analysis cannot prove converges (known limitation)", () => {
    // millionco/expect TextCarousel: this DOES converge at runtime — the write
    // makes the last item's text equal \`text\`, so next run \`text ===
    // current.text\` bails. But proving that needs tracking the written object's
    // field through an equality guard against a derived snapshot, which we do
    // not attempt. The write (\`[...prev.slice(-1), {…}]\`) grows rather than
    // shrinking toward empty, so we stay sound and flag. Accepted residual FP.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function TextCarousel({ text }) {
        const [items, setItems] = useState([{ text, id: 0 }]);
        useEffect(() => {
          const current = items[items.length - 1];
          if (text === current.text) return;
          setItems((previous) => [...previous.slice(-1), { text, id: 1 }]);
        }, [text, items]);
        return null;
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a fresh-reference loop when a state-derived local is not used in a guard", () => {
    // A local derived from \`items\` exists, but there is no early-return guard
    // reading it — nothing bounds the loop, so the fresh-array write stays
    // flagged. Guards against the derived-local exemption over-suppressing.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List() {
        const [items, setItems] = useState([]);
        useEffect(() => {
          const count = items.length;
          setItems([...items, count]);
        }, [items]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when an early-return guard reads only an unrelated dependency", () => {
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter({ ready }) {
        const [count, setCount] = useState(0);
        useEffect(() => {
          if (!ready) {
            return;
          }
          setCount((value) => value + 1);
        }, [count, ready]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  // ---- recall: a guard reading the state must NOT silence a write that keeps
  // diverging. These are the cases an over-broad "any guard exempts" heuristic
  // would wrongly hide. ----

  it("still flags a diverging increment even when a guard reads the same state", () => {
    // \`x == null\` reads x but the write \`x + 1\` never makes x null, so the
    // guard never fires from the loop — genuine infinite loop, must flag.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function Counter() {
        const [x, setX] = useState(0);
        useEffect(() => {
          if (x == null) {
            return;
          }
          setX(x + 1);
        }, [x]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a length-reducing write under a high-watermark guard", () => {
    // \`slice(1)\` drives the array toward empty, AWAY from the \`length > 5\`
    // guard, and \`[].slice(1)\` stays a fresh empty array forever — loops at the
    // empty fixpoint, so it must flag.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List() {
        const [items, setItems] = useState([]);
        useEffect(() => {
          if (items.length > 5) {
            return;
          }
          setItems((prev) => prev.slice(1));
        }, [items]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an appending write under an emptiness guard", () => {
    // \`[...prev, x]\` grows the array; the \`!items.length\` guard only fires when
    // empty, which the append moves away from — diverges, must flag.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List({ x }) {
        const [items, setItems] = useState([x]);
        useEffect(() => {
          if (!items.length) {
            return;
          }
          setItems((prev) => [...prev, x]);
        }, [items, x]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an empty reset whose emptiness exit depends on other unproven state", () => {
    // \`setItems([])\` drives toward empty, but the guard only bails when \`ready\`
    // is also false — reaching empty alone does not stop it, so we cannot prove
    // convergence and must flag.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List({ ready }) {
        const [items, setItems] = useState([]);
        useEffect(() => {
          if (ready && items.length === 0) {
            return;
          }
          setItems([]);
        }, [items, ready]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an empty reset whose guard exits purely on emptiness (|| form)", () => {
    // The \`!items.length\` disjunct fires once the reset empties the array, so
    // the effect provably converges — must stay quiet.
    const result = runRule(
      noSelfUpdatingEffect,
      `
      import { useEffect, useState } from "react";

      function List({ busy }) {
        const [items, setItems] = useState([]);
        useEffect(() => {
          if (busy || !items.length) {
            return;
          }
          setItems([]);
        }, [items, busy]);
        return null;
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(0);
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
