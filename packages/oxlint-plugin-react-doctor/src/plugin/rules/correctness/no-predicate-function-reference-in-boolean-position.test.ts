import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPredicateFunctionReferenceInBooleanPosition } from "./no-predicate-function-reference-in-boolean-position.js";

describe("no-predicate-function-reference-in-boolean-position", () => {
  it("flags `if (!isNewBoardsOn)` (production commit shape)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isNewBoardsOn() {
        return featureFlags.newBoards;
      }
      function followBrand() {
        if (!isNewBoardsOn) {
          return;
        }
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("isNewBoardsOn()");
  });

  it("flags a bare predicate in an if test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isReady = () => true;
      if (isReady) {
        start();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate in a ternary test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function hasAccess() { return true; }
      const label = hasAccess ? "yes" : "no";
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const alias of a local predicate", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `const isReady = () => true;
      const hasAccess = isReady;
      if (hasAccess) start();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate through TypeScript expression wrappers", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `const isReady = () => true;
      if ((isReady as (() => boolean))) start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a later same-scope assignment hide an earlier misuse", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `let isReady = () => true;
      if (isReady) start();
      isReady = null;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate in a while test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function shouldContinue() { return false; }
      while (shouldContinue) {
        step();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate operand inside an `if (a && ...)` test", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function canEdit() { return true; }
      function render(user) {
        if (user.loggedIn && canEdit) {
          edit();
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare predicate as the left operand of `&&` in a JSX conditional render", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isLoading() { return state.loading; }
      function App() {
        return <div>{isLoading && <Spinner />}</div>;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("isLoading()");
  });

  it("flags a bare predicate guarding an expression statement via `&&`", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isReady() { return true; }
      isReady && start();
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the predicate is called", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isReady() { return true; }
      if (isReady()) {
        start();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a PascalCase component existence check", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function IsLazy() { return null; }
      function App() {
        if (IsLazy) {
          return <IsLazy />;
        }
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a boolean variable named like a predicate", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isActive = true;
      if (isActive) {
        run();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate passed as a callback", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isEven = (n) => n % 2 === 0;
      const evens = numbers.filter(isEven);
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a one-arg predicate used as a condition", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isValid(value) { return Boolean(value); }
      if (isValid) {
        run();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a predicate with a defaulted parameter used as a condition", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `const isReady = (force = false) => force; if (isReady) start();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a predicate used for value selection with ||", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isReady() { return true; }
      const chosen = isReady || fallback;
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an imported predicate (arity/type unknown)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      import { isMobile } from "./env";
      if (isMobile) {
        renderMobile();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a predicate stored then existence-checked before calling", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isActive() { return true; }
      const check = isActive;
      if (check) {
        check();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reassignable `let` function slot guarded before its call (start/stop polling idiom)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      let isPolling = () => false;
      function stop() { isPolling = null; }
      function tick() {
        if (isPolling) {
          isPolling();
        }
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a hoisted `var` assigned only inside a conditional block (feature-detection idiom)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function detect(flag) {
        if (flag) {
          var isSupported = function () { return true; };
        }
        if (isSupported) {
          return isSupported();
        }
        return false;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a destructured prop with a function default (caller may pass a boolean)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function Menu({ isOpen = () => false }) {
        if (isOpen) {
          return open();
        }
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an existence guard whose branch invokes the predicate (defensive-call idiom)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      function isEnabled() { return true; }
      if (isEnabled) {
        isEnabled();
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a same-named shadow as use of the guarded predicate", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isEnabled() { return true; }
      if (isEnabled) {
        const isEnabled = false;
        consume(isEnabled);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `predicate && predicate()` (inline existence-guarded call idiom)", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `
      const isDone = () => true;
      isDone && isDone();
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an existence guard whose branch registers the reference", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isSessionValid() { return Date.now() < session.expiresAt; }
      const guards = [];
      if (isSessionValid) {
        guards.push(isSessionValid);
      }
      export { guards };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ternary value-selection passing the reference through", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isRowSelectable() { return !table.locked; }
      export function Grid(props) {
        return <DataGrid rows={props.rows} isRowSelectable={isRowSelectable ? isRowSelectable : undefined} />;
      }`,
      { filename: "grid.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a negated existence guard with the evaluation in the else branch", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isSessionValid() { return session.active; }
      function render() {
        if (!isSessionValid) {
          return fallback();
        } else if (isSessionValid()) {
          return content();
        }
        return login();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag f && wrap(f) composition guards", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isEnabled() { return flags.enabled; }
      const gate = isEnabled && withLogging(isEnabled);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an existence guard invoking via .call", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isReadyCheck() { return state.ready; }
      if (isReadyCheck) { isReadyCheck.call(context); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an existence guard returning the reference", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `function isDefaultResolver() { return true; }
      function pickResolver(custom) {
        if (isDefaultResolver) return isDefaultResolver;
        return custom;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an aliased parameter default as an unconditional function value", () => {
    const result = runRule(
      noPredicateFunctionReferenceInBooleanPosition,
      `const fallback = () => false;
      function useReady(isReady = fallback) {
        if (!isReady) return;
        isReady();
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
