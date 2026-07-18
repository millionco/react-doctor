import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWholeObjectDefaultLosingPerKeyDefaults } from "./no-whole-object-default-losing-per-key-defaults.js";

describe("no-whole-object-default-losing-per-key-defaults", () => {
  it("flags a multi-key whole-object default with undefaulted bindings", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const useActive = ({ exact, loading } = { exact: true, loading: false }) => {};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a function declaration with a partial whole-object default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function setup({ path, type } = { path: '' }) {}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a single-key whole-object default with an undefaulted binding", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function useConvertD3ToBreadcrumbs({ data } = { data: someDefault }) {}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when only some bindings carry their own default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a = 1, b } = { a: 1, b: 2 }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when every binding already carries its own default", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const useNavLinks = ({ provider = p, owner = o } = { provider: p, owner: o }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the empty-object default idiom", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const fn = ({ a = 1, b = false } = {}) => {};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a test-helper with every binding pre-defaulted", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function setup({ triggerError = false, showStaticAnalysis = true, plan = free } = { triggerError: false, showStaticAnalysis: true, plan: free }) {}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when there is no whole-object default at all", () => {
    const result = runRule(noWholeObjectDefaultLosingPerKeyDefaults, `const f = ({ a, b }) => {};`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a spread-only default object (no per-key value)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a, b } = { ...base }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a nested destructuring default as a parameter default", () => {
    const result = runRule(noWholeObjectDefaultLosingPerKeyDefaults, `const { a, b } = { a: 1 };`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the default is not an object expression", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a, b } = base) => {};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an all-false boolean-flag bag because false and undefined are observably different", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const onReset = ({ confirm, closeDropdown } = { confirm: false, closeDropdown: false }) => { if (confirm) {} if (closeDropdown) {} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a flag bag when any dropped fallback is a truthy literal", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const fn = ({ confirm, closeDropdown } = { confirm: false, closeDropdown: true }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a dropped empty-string fallback (falsy literals other than false diverge from undefined under member access)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const fn = ({ path, ok } = { path: '', ok: false }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the default object only covers bindings that already carry their own default (hook options idiom)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function useThing({ signal, retries = 3 } = { retries: 5 }) {}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the undefaulted binding has no matching key in the default object", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const f = ({ a = 1, b } = { a: 1 }) => {};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when every in-file call site passes the at-risk key explicitly (PortOS finishSession shape)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const Panel = () => {
        const finishSession = async ({ keep } = { keep: true }) => {
          use(keep);
        };
        return (
          <div>
            <button onClick={() => finishSession({ keep: true })}>Finish</button>
            <button onClick={() => finishSession({ keep: false })}>Discard</button>
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a call site omits the argument entirely (whole-object default applies intact)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const run = () => {
        const start = ({ retries } = { retries: 3 }) => use(retries);
        start();
        start({ retries: 5 });
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when any in-file call site passes a partial object", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const run = () => {
        const start = ({ retries, delay } = { retries: 3, delay: 100 }) => use(retries, delay);
        start({ retries: 5 });
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the function escapes as a value (antd confirm-callback shape)", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const FilterDropdown = ({ render }) => {
        const doFilter = ({ closeDropdown } = { closeDropdown: true }) => use(closeDropdown);
        doFilter({ closeDropdown: true });
        return render({ confirm: doFilter });
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an exported function even when in-file call sites are complete", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `export const start = ({ retries } = { retries: 3 }) => use(retries);
       start({ retries: 5 });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a component with a whole-object default that is rendered as JSX", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const Actions = ({ actionType } = { actionType: 'inline-button-dropdown' }) => (
         <div>{actionType}</div>
       );
       const Page = () => <Actions actionType="inline-button-dropdown" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a false fallback even when neighboring fallbacks are undefined", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `export const createGraphQLRunner = (
        store,
        { parentSpan, graphqlTracing } = { parentSpan: undefined, graphqlTracing: false },
      ) => use(store, parentSpan, graphqlTracing);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when an undefined fallback sits beside an observable one", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `export const setup = ({ span, retries } = { span: undefined, retries: 3 }) => use(span, retries);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a whole-object default wrapped in a TS `as` assertion", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function f({ a, b } = { a: 1 } as Options) {}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a whole-object default wrapped in a TS `satisfies` expression", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `function f({ a, b } = { a: 1 } satisfies Partial<Options>) {}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the at-risk property is required by an inline annotation", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const Trigger = (
        { renderTrigger }: { renderTrigger: () => React.ReactNode } = {
          renderTrigger: () => <button type="button">Open</button>,
        }
      ) => renderTrigger();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a same-file interface requires every observable fallback", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `interface BillingOptions {
        onSuccess: (redirectUrl: string) => void;
        onError: () => void;
      }
      export const useSubscribe = (
        { onSuccess, onError }: BillingOptions = {
          onSuccess: () => {},
          onError: () => {},
        }
      ) => use(onSuccess, onError);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when optional callback defaults are no-ops and every call is optional", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `interface Options { onSuccess?: () => void; onError?: () => void }
      export const useCreate = (
        { onSuccess, onError }: Options = {
          onSuccess: () => { return; },
          onError: () => { return; },
        }
      ) => {
        onSuccess?.();
        onError?.();
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an optional callback fallback when code calls it unconditionally", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `interface Options { onSuccess?: () => void }
      export const useCreate = (
        { onSuccess }: Options = { onSuccess: () => {} }
      ) => onSuccess();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("audit regressions", () => {
  it("does not mistake a shadowed undefined value for the missing-value primitive", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const undefined = 3; export const read = ({ value } = { value: undefined }) => value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats explicit undefined like an omitted argument", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `const read = ({ value } = { value: 1 }) => value; read(undefined);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume false and undefined are behaviorally identical", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `export const read = ({ enabled } = { enabled: false }) => enabled === false;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a required fallback inherited from a same-file interface", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `interface RequiredValue { value: string }
       interface Options extends RequiredValue {}
       export const read = ({ value }: Options = { value: "fallback" }) => value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a required fallback from a merged interface declaration", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `interface Options { enabled?: boolean }
       interface Options { value: string }
       export const read = ({ value }: Options = { value: "fallback" }) => value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a property required by every union member", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `type Options = { value: string } | { value: string; enabled: boolean };
       export const read = ({ value }: Options = { value: "fallback" }) => value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports when one union member makes the fallback optional", () => {
    const result = runRule(
      noWholeObjectDefaultLosingPerKeyDefaults,
      `type Options = { value: string } | { value?: string; enabled: boolean };
       export const read = ({ value }: Options = { value: "fallback" }) => value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
