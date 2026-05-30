import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reduxUseselectorInlineDerivation } from "./redux-useselector-inline-derivation.js";

describe("redux-useselector-inline-derivation", () => {
  it("flags an inline .filter in the selector body", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const activeUsers = useSelector((state) =>
        state.users.filter((user) => new Date(user.loginDate).getFullYear() === 2023),
      );
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".filter");
  });

  it("flags an inline .map in the selector body", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const names = useSelector((state) => state.users.map((user) => user.name));
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".map");
  });

  it("flags a .toSorted call in a block-body selector", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const sorted = useSelector((state) => {
        return state.users.toSorted((a, b) => a.name.localeCompare(b.name));
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".toSorted");
  });

  it("flags Object.keys / Object.values / Object.entries selectors", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const userKeys = useSelector((state) => Object.keys(state.usersById));
      const userValues = useSelector((state) => Object.values(state.usersById));
    `,
    );

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].message).toContain("Object.keys");
    expect(result.diagnostics[1].message).toContain("Object.values");
  });

  it("does not recurse into nested callbacks — those run lazily, not on every store update", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const lazyDeriver = useSelector((state) => {
        return () => state.users.filter((user) => user.active);
      });
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag selectors paired with a second equality argument", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector, shallowEqual } from "react-redux";

      const value = useSelector((state) => state.users.map((u) => u.id), shallowEqual);
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag .reduce (returns any type, often a primitive)", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const totalScore = useSelector((state) =>
        state.users.reduce((sum, user) => sum + user.score, 0),
      );

      const merged = useSelector((state) =>
        state.entries.reduceRight((acc, entry) => ({ ...acc, ...entry }), {}),
      );
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag selectors returning a plain slice", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const users = useSelector((state) => state.users);
      const count = useSelector((state) => state.counter.value);
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag selectors hoisted into a named function reference", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";
      import { selectActiveUsers } from "./selectors";

      const active = useSelector(selectActiveUsers);
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags an inline .filter through a same-file typed-wrapper rebinding", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";
      import type { TypedUseSelectorHook } from "react-redux";

      export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

      const activeUsers = useAppSelector((state) =>
        state.users.filter((u) => u.active),
      );
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain(".filter");
  });

  it("does not flag a useSelector imported from a different module", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "not-react-redux";

      const value = useSelector((state) => state.users.map((u) => u.id));
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags only the first allocating call when several are present", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const value = useSelector((state) =>
        state.users.filter((user) => user.active).map((user) => user.name),
      );
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag allocations in block-body selectors that are not returned", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const value = useSelector((state) => {
        const ids = state.users.map((user) => user.id);
        console.log(ids);
        return state.selectedUser;
      });
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags allocations in the return statement of block-body selectors", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const value = useSelector((state) => {
        const threshold = 10;
        return state.users.filter((user) => user.score > threshold);
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a primitive derived via .length from a transient allocation", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const activeCount = useSelector((state) => state.users.filter((u) => u.active).length);
      const keyCount = useSelector((state) => Object.keys(state.byId).length);
    `,
    );

    // Both return a stable number — \`===\` succeeds, so there is no
    // extra re-render to warn about.
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a string derived via .join() from a transient allocation", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const csv = useSelector((state) => state.tags.map((t) => t.id).join(","));
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags a fresh array returned through a conditional", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `
      import { useSelector } from "react-redux";

      const rows = useSelector((state) =>
        state.showAll ? state.users.filter((u) => u.active) : state.recent,
      );
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
