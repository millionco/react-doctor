import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

interface RecordSelectionCase {
  name: string;
  setup: string;
  call?: string;
  expectedDiagnostics: number;
}

const selectionCases: RecordSelectionCase[] = [
  {
    name: "imported-member-alias",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 0,
  },
  {
    name: "imported-string-member-alias",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers['dispatch'];",
    expectedDiagnostics: 0,
  },
  {
    name: "selected-import-alias",
    setup:
      "const localCallback = importedCallback; const handlers = { notify: parentProp, dispatch: localCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 0,
  },
  {
    name: "direct-imported-member",
    setup: "const handlers = { notify: parentProp, dispatch: importedCallback };",
    call: "handlers.dispatch(localValue)",
    expectedDiagnostics: 0,
  },
  {
    name: "remove-parent-sibling",
    setup: "const handlers = { dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 0,
  },
  {
    name: "selected-parent-member",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers.notify;",
    expectedDiagnostics: 1,
  },
  { name: "direct-parent-alias", setup: "const chosen = parentProp;", expectedDiagnostics: 1 },
  {
    name: "real-callback-ref",
    setup: "const callbackRef = useRef(parentProp);",
    call: "callbackRef.current(localValue)",
    expectedDiagnostics: 1,
  },
  {
    name: "selected-child-call-result",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers.notify; const childValue = readChildData();",
    call: "chosen(childValue)",
    expectedDiagnostics: 1,
  },
  {
    name: "dynamic-selection-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers[selectionKey];",
    expectedDiagnostics: 1,
  },
  {
    name: "getter-hold",
    setup:
      "const handlers = { notify: parentProp, get dispatch() { return importedCallback; } }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "method-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch() { return importedCallback; } }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "duplicate-key-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "spread-hold",
    setup:
      "const handlers = { notify: parentProp, ...otherHandlers, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "member-mutation-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; handlers.dispatch = parentProp; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "unselected-mutation-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; handlers.notify = importedCallback; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "record-replacement-hold",
    setup:
      "let handlers = { notify: parentProp, dispatch: importedCallback }; handlers = otherHandlers; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "alias-mutation-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const alias = handlers; alias.dispatch = parentProp; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "opaque-call-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; opaque(handlers); const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "alias-escape-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const alias = handlers; opaque(alias); const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "receiver-call-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; handlers.notify(); const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "context-result-hold",
    setup:
      "const contextCallback = useContext(DispatchContext); const handlers = { notify: parentProp, dispatch: contextCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "provider-result-hold",
    setup:
      "const providerCallback = useDispatchProvider(); const handlers = { notify: parentProp, dispatch: providerCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },

  {
    name: "renamed-imported-key",
    setup:
      "const handlers = { notify: parentProp, process: importedCallback }; const chosen = handlers.process;",
    expectedDiagnostics: 0,
  },
  {
    name: "wrapped-selection",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = (handlers.dispatch as typeof importedCallback);",
    expectedDiagnostics: 0,
  },
  {
    name: "unselected-getter-hold",
    setup:
      "const handlers = { get notify() { return parentProp; }, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "dynamic-property-hold",
    setup:
      "const handlers = { notify: parentProp, [selectionKey]: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "prototype-property-hold",
    setup:
      "const handlers = { __proto__: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "record-alias-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const alias = handlers; const chosen = alias.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "selected-call-result-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: createCallback() }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "shadowed-import-hold",
    setup:
      "const importedCallback = parentProp; const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "mutable-import-alias-hold",
    setup:
      "let localCallback = importedCallback; const handlers = { notify: parentProp, dispatch: localCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "reassigned-import-alias-hold",
    setup:
      "const localCallback = importedCallback; localCallback = parentProp; const handlers = { notify: parentProp, dispatch: localCallback }; const chosen = handlers.dispatch;",
    expectedDiagnostics: 1,
  },
  {
    name: "reassigned-selected-alias-hold",
    setup:
      "const handlers = { notify: parentProp, dispatch: importedCallback }; const chosen = handlers.dispatch; chosen = parentProp;",
    expectedDiagnostics: 1,
  },
];

describe("no-pass-data-to-parent imported record member aliases", () => {
  it.each(selectionCases)("$name", ({ setup, call, expectedDiagnostics }) => {
    const result = runRule(
      noPassDataToParent,
      `import { useEffect, useReducer, useRef, useContext } from "react";
import { importedCallback } from "./external-callback";
const Child = ({ parentProp, selectionKey, otherHandlers }) => {
  const [localValue] = useReducer((previousValue) => previousValue + 1, 0);
  ${setup}
  useEffect(() => { ${call ?? "chosen(localValue)"}; }, [localValue]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedDiagnostics);
  });
});
