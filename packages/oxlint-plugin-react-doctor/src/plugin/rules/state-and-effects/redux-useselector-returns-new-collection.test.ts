import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reduxUseselectorReturnsNewCollection } from "./redux-useselector-returns-new-collection.js";

describe("redux-useselector-returns-new-collection", () => {
  it("flags concise arrow returning an inline object", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      function Component() {
        const { name, email } = useSelector((state) => ({
          name: state.user.name,
          email: state.user.email,
        }));
      }
    `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("re-renders on every dispatched action");
  });

  it("flags concise arrow returning an inline array", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      function Component() {
        const [first, second] = useSelector((state) => [state.a, state.b]);
      }
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags block-body arrow returning an inline object on the last statement", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      const value = useSelector((state) => {
        return { count: state.count, total: state.total };
      });
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags spread-into-object selectors", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      const user = useSelector((state) => ({ ...state.user, fullName: state.user.name }));
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag selectors returning a primitive", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      const count = useSelector((state) => state.count);
      const name = useSelector((state) => state.user.name);
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag selectors paired with a second equality argument", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector, shallowEqual } from "react-redux";

      const value = useSelector((state) => ({ a: state.a, b: state.b }), shallowEqual);

      const other = useSelector(
        (state) => ({ a: state.a }),
        (left, right) => left.a === right.a,
      );
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag useSelector imported from a non-react-redux module", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "not-react-redux";

      const value = useSelector((state) => ({ a: state.a }));
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("flags a same-file typed-wrapper rebinding of useSelector", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      const useAppSelector = useSelector;

      const value = useAppSelector((state) => ({ a: state.a }));
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a same-file typed-wrapper rebinding with TypedUseSelectorHook annotation", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";
      import type { TypedUseSelectorHook } from "react-redux";

      export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

      const value = useAppSelector((state) => ({ a: state.a, b: state.b }));
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained alias `useTwoStepSelector = useAppSelector = useSelector`", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";

      const useAppSelector = useSelector;
      const useTwoStepSelector = useAppSelector;

      const value = useTwoStepSelector((state) => ({ a: state.a }));
    `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a renamed import that is NOT useSelector", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useDispatch as useAppSelector } from "react-redux";

      const value = useAppSelector((state) => ({ a: state.a }));
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag selectors passed by reference (hoisted out)", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      import { useSelector } from "react-redux";
      import { selectActiveUsers } from "./selectors";

      const users = useSelector(selectActiveUsers);
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a useSelector that's actually a local helper", () => {
    const result = runRule(
      reduxUseselectorReturnsNewCollection,
      `
      function useSelector(fn) {
        return fn({});
      }

      const value = useSelector((state) => ({ a: state.a }));
    `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
