import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hooksNoNanInDeps } from "./hooks-no-nan-in-deps.js";

describe("hooks-no-nan-in-deps", () => {
  it("flags `NaN` in a useEffect dep array with the corrected (Object.is-aware) message", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => { doStuff(); }, [NaN]);
        return null;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`NaN`");
    // The diagnostic must describe React's *actual* comparator behaviour
    // — `Object.is(NaN, NaN) === true`, so the hook does NOT re-run on
    // every render. Regression guard against the previous wording that
    // wrongly claimed it "always reruns".
    expect(result.diagnostics[0].message).toContain("Object.is");
    expect(result.diagnostics[0].message).not.toContain("always rerun");
  });

  it("flags `Number.NaN` in a useMemo dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useMemo } from "react";
      const Comp = ({ value }) => {
        const memoised = useMemo(() => compute(value), [value, Number.NaN]);
        return memoised;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a useCallback dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useCallback } from "react";
      const Comp = ({ id }) => {
        const handler = useCallback(() => onSelect(id), [id, NaN]);
        return <button onClick={handler}>x</button>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a useImperativeHandle dep array (3rd argument)", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useImperativeHandle } from "react";
      const Comp = ({ ref }) => {
        useImperativeHandle(ref, () => ({ focus: () => {} }), [NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in an aliased useImperativeHandle dependency array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useImperativeHandle as exposeHandle } from "react";
      const Comp = ({ ref }) => {
        exposeHandle(ref, () => ({ focus: () => {} }), [NaN]);
        return null;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not lint `useSignalEffect` (Preact signals — single-arg API, no deps array)", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useSignalEffect } from "@preact/signals";
      // Even if a user fabricates a second argument, the hook ignores
      // it — auto-tracking inside the callback is the contract.
      const Comp = () => {
        useSignalEffect(() => log());
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a normal dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = ({ id, name }) => {
        useEffect(() => fetch(id), [id, name]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag empty deps", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => mountOnce(), []);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag missing deps array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => doStuff());
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-hook calls passing NaN", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      const config = createThing("foo", [NaN]);
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags `NaN` when the hook is called via a `React.useEffect` member expression", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import * as React from "react";
      const Comp = () => {
        React.useEffect(() => { doStuff(); }, [NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `NaN` in a `React.useImperativeHandle` (member-expression + index-2 deps) call", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import * as React from "react";
      const Comp = ({ ref }) => {
        React.useImperativeHandle(ref, () => ({ focus: () => {} }), [NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple NaN entries in one dep array", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `
      import { useEffect } from "react";
      const Comp = () => {
        useEffect(() => {}, [NaN, Number.NaN, NaN]);
        return null;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(3);
  });

  it("stays silent on shadowed finite NaN and Number.NaN bindings", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const NaN = 1;
const Number = { NaN: 2 };
const Comp = () => {
  useEffect(() => {}, [NaN, Number.NaN]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags exact immutable aliases of the global NaN values", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const firstValue = Number.NaN;
const secondValue = firstValue;
const Comp = () => {
  useEffect(() => {}, [secondValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an exact destructured alias of global Number.NaN", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const { NaN: invalidValue } = Number;
const Comp = () => {
  useEffect(() => {}, [invalidValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent across a mutable NaN alias", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
let invalidValue = Number.NaN;
invalidValue = 0;
const Comp = () => {
  useEffect(() => {}, [invalidValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a spread precedes the matched index in an array-destructure initializer", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const others = [1, 2];
const [firstValue, secondValue] = [...others, Number.NaN];
const Comp = () => {
  useEffect(() => {}, [secondValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an array-destructured NaN when a spread follows the matched index", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const others = [1, 2];
const [firstValue] = [Number.NaN, ...others];
const Comp = () => {
  useEffect(() => {}, [firstValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the array-destructured binding at a non-zero NaN initializer index", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const [, secondValue] = [0, Number.NaN];
const Comp = () => {
  useEffect(() => {}, [secondValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an array-destructured binding whose initializer index holds a finite value", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const [firstValue] = [0, Number.NaN];
const Comp = () => {
  useEffect(() => {}, [firstValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent (and does not crash) on a self-referential const alias", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const selfValue = selfValue;
const Comp = () => {
  useEffect(() => {}, [selfValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a computed string-key destructure of global Number.NaN", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const { ["NaN"]: computedValue } = Number;
const Comp = () => {
  useEffect(() => {}, [computedValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a NaN-keyed destructure off a non-global receiver", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const localNumber = { NaN: 2 };
const { NaN: aliasValue } = localNumber;
const Comp = () => {
  useEffect(() => {}, [aliasValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags Number.NaN aliases through transparent TypeScript wrappers", () => {
    const result = runRule(
      hooksNoNanInDeps,
      `import { useEffect } from "react";
const directValue = (Number as typeof Number).NaN;
const { NaN: destructuredValue } = Number as typeof Number;
const [arrayValue] = [Number.NaN as number] as const;
const Comp = () => {
  useEffect(() => {}, [directValue, destructuredValue, arrayValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });
});
