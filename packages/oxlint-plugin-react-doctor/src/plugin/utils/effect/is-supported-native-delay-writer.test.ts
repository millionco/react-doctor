import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { walkAst } from "../walk-ast.js";
import { isSupportedNativeDelayWriter } from "./is-supported-native-delay-writer.js";
import { NATIVE_DELAY_PROTECTED_MEMBER_NAMES } from "./native-signal-delay/constants.js";

interface ProtectedWriterCase {
  name: string;
  source: string;
  defaultAccepted: boolean;
  builderAccepted: boolean;
}

const builderMemberNames = new Set([
  ...NATIVE_DELAY_PROTECTED_MEMBER_NAMES,
  "Map",
  "Array",
  "get",
  "push",
]);

const acceptsSource = (source: string, protectedMemberNames?: ReadonlySet<string>): boolean => {
  const result = runRule(
    {
      id: "test-protected-writer",
      severity: "warn",
      create: (context) => ({
        "Program:exit": (node) => {
          let accepted = true;
          walkAst(node, (candidate) => {
            if (!isSupportedNativeDelayWriter(candidate, context.scopes, protectedMemberNames)) {
              accepted = false;
              return false;
            }
          });
          if (accepted) context.report({ node, message: "accepted" });
        },
      }),
    },
    source,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length === 1;
};

const cases: ReadonlyArray<ProtectedWriterCase> = [
  {
    name: "unproved get writer",
    source: "receiver.get = replacement;",
    defaultAccepted: true,
    builderAccepted: false,
  },
  {
    name: "reflected push writer",
    source: "Object.defineProperty(receiver, 'push', { value: replacement });",
    defaultAccepted: true,
    builderAccepted: false,
  },
  {
    name: "assigned method record",
    source: "Object.assign(receiver, { get: replacement });",
    defaultAccepted: true,
    builderAccepted: false,
  },
  {
    name: "reflected Map global replacement",
    source: "Reflect.set(globalThis, 'Map', replacement);",
    defaultAccepted: true,
    builderAccepted: false,
  },
  {
    name: "private empty record method writer",
    source: "const record = {}; record.get = replacement;",
    defaultAccepted: true,
    builderAccepted: true,
  },
  {
    name: "private empty record reflected writer",
    source: "const record = {}; Object.defineProperty(record, 'push', { value: replacement });",
    defaultAccepted: true,
    builderAccepted: true,
  },
  {
    name: "existing cancellation writer",
    source: "receiver.abort = replacement;",
    defaultAccepted: false,
    builderAccepted: false,
  },
  {
    name: "unproved computed writer",
    source: "receiver[key] = replacement;",
    defaultAccepted: false,
    builderAccepted: false,
  },
];

describe("builder-scoped native writer protection", () => {
  it.each(cases)("preserves default behavior for $name", (testCase) => {
    expect(acceptsSource(testCase.source)).toBe(testCase.defaultAccepted);
    expect(acceptsSource(testCase.source, builderMemberNames)).toBe(testCase.builderAccepted);
  });
});
