import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import * as functionMetadata from "../../utils/is-function-metadata-read.js";
import * as unreachableBranches from "../../utils/is-inside-statically-unreachable-branch.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface NamedTimerEffectOptions {
  timerCount: number;
  referenceCount: number;
  isStoredPublisher?: boolean;
  extraNamedReference?: string;
  extraPublisherStatement?: string;
  hasMultipleHandleDeclarations?: boolean;
}

const createNamedTimerEffect = ({
  timerCount,
  referenceCount,
  isStoredPublisher = false,
  extraNamedReference = "",
  extraPublisherStatement = "",
  hasMultipleHandleDeclarations = false,
}: NamedTimerEffectOptions): string => {
  let timerCallbackBody = Array.from(
    { length: referenceCount },
    () => "if (false) registerPolling(); void registerPolling.name;",
  ).join("\n");
  timerCallbackBody += `\n${extraNamedReference}`;
  for (let helperIndex = 7; helperIndex >= 0; helperIndex -= 1) {
    timerCallbackBody = `const nested${helperIndex} = () => { ${timerCallbackBody} }; nested${helperIndex}();`;
  }
  const timerDeclarations = Array.from(
    { length: timerCount },
    (_, timerIndex) =>
      `const timer${timerIndex} = setInterval(() => { ${timerIndex === 0 ? timerCallbackBody : ""} }, 1000);`,
  );
  if (hasMultipleHandleDeclarations) {
    timerDeclarations[0] =
      timerDeclarations[0]?.replace(/;$/, ", extraTimer = setInterval(() => {}, 1000);") ?? "";
  }
  const releaseCalls = Array.from(
    { length: timerCount },
    (_, timerIndex) => `clearInterval(timer${timerIndex});`,
  ).join("\n");
  const disposer = timerCount === 1 ? "() => clearInterval(timer0)" : `() => { ${releaseCalls} }`;
  const body = isStoredPublisher
    ? `let release = () => {}; void (async () => {
        ${timerDeclarations.join("\n")}
        release = ${disposer};
        await ready;
        ${extraPublisherStatement}
      })();
      return () => release();`
    : `${timerDeclarations.join("\n")} return () => { ${releaseCalls} };`;
  return `
    import { useEffect } from "react";
    export const TimerWorkload = ({ ready }) => {
      useEffect(function registerPolling() { ${body} }, [ready]);
      return null;
    };
  `;
};

const inspectNamedReferenceWork = (source: string) => {
  const metadata = vi.spyOn(functionMetadata, "isFunctionMetadataRead");
  const unreachable = vi.spyOn(unreachableBranches, "isInsideStaticallyUnreachableBranch");
  const result = runRule(effectNeedsCleanup, source, {
    filename: "/app/src/timer-workload.tsx",
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  const metadataCalls = metadata.mock.calls.filter(
    ([identifier]) =>
      isNodeOfType(identifier, "Identifier") && identifier.name === "registerPolling",
  ).length;
  const unreachableCalls = unreachable.mock.calls.filter(
    ([identifier]) =>
      isNodeOfType(identifier, "Identifier") && identifier.name === "registerPolling",
  ).length;
  return { result, metadataCalls, unreachableCalls };
};

afterEach(() => vi.restoreAllMocks());

describe("synchronous disposer structural eligibility before named references", () => {
  it.each([16, 64, 256])(
    "avoids named-reference scans for %s directly released timers",
    (timerCount) => {
      const observation = inspectNamedReferenceWork(
        createNamedTimerEffect({ timerCount, referenceCount: timerCount }),
      );
      expect(observation.result.diagnostics).toEqual([]);
      expect(observation.metadataCalls).toBe(0);
      expect(observation.unreachableCalls).toBe(0);
    },
  );

  it.each([16, 64, 256])(
    "retains named-reference checks for an eligible publisher with %s reference pairs",
    (referenceCount) => {
      const observation = inspectNamedReferenceWork(
        createNamedTimerEffect({ timerCount: 1, referenceCount, isStoredPublisher: true }),
      );
      expect(observation.result.diagnostics).toEqual([]);
      expect(observation.metadataCalls).toBe(referenceCount);
      expect(observation.unreachableCalls).toBe(referenceCount * 2);
    },
  );

  it.each([
    "registerPolling();",
    'registerPolling.name = "changed";',
    "registerPolling.length++;",
    "void registerPolling.prototype;",
  ])("keeps unsafe named publisher reference conservative: %s", (extraNamedReference) => {
    const observation = inspectNamedReferenceWork(
      createNamedTimerEffect({
        timerCount: 1,
        referenceCount: 16,
        isStoredPublisher: true,
        extraNamedReference,
      }),
    );
    expect(observation.result.diagnostics).toHaveLength(1);
    expect(observation.metadataCalls).toBeGreaterThan(0);
    expect(observation.unreachableCalls).toBeGreaterThan(0);
  });

  it("rejects a fourth publisher statement before scanning references", () => {
    const observation = inspectNamedReferenceWork(
      createNamedTimerEffect({
        timerCount: 1,
        referenceCount: 64,
        isStoredPublisher: true,
        extraPublisherStatement: "void ready;",
      }),
    );
    expect(observation.result.diagnostics).toHaveLength(1);
    expect(observation.metadataCalls).toBe(0);
    expect(observation.unreachableCalls).toBe(0);
  });

  it("rejects multiple allocation declarators before scanning references", () => {
    const observation = inspectNamedReferenceWork(
      createNamedTimerEffect({
        timerCount: 1,
        referenceCount: 64,
        isStoredPublisher: true,
        hasMultipleHandleDeclarations: true,
      }),
    );
    expect(observation.result.diagnostics).toHaveLength(1);
    expect(observation.metadataCalls).toBe(0);
    expect(observation.unreachableCalls).toBe(0);
  });

  it("preserves the unsupported multi-timer publisher boundary", () => {
    const observation = inspectNamedReferenceWork(
      createNamedTimerEffect({ timerCount: 16, referenceCount: 64, isStoredPublisher: true }),
    );
    expect(observation.result.diagnostics).toHaveLength(1);
    expect(observation.metadataCalls).toBe(0);
    expect(observation.unreachableCalls).toBe(0);
  });
});
