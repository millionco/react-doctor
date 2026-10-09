import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

const settings = { "react-doctor": { framework: "vite" } };

describe("only-export-components JSX binding evidence", () => {
  it.each([
    "export function SeasonRecordGate<Result>({ configuration, children }: Props<Result>)",
    "export const SeasonRecordGate = <Result,>({ configuration, children }: Props<Result>) =>",
    "export const SeasonRecordGate = function<Result>({ configuration, children }: Props<Result>)",
  ])("accepts an imported matcher in %s", (declaration) => {
    const result = runRule(
      onlyExportComponents,
      `import type { ReactNode } from "react";
       import { match } from "./match";
       ${declaration} {
         const { readState } = useReadState(configuration);
         return match(readState, {
           loading: (): ReactNode => <WaitingNote />,
           failed: ({ reason }): ReactNode => <StateNotice reason={reason} />,
           ready: ({ readValue }): ReactNode => <SeasonSwitch record={readValue}>{children}</SeasonSwitch>,
         });
       }
       export function PlayerSeasonRecordGate() {
         return <SeasonRecordGate configuration={configuration}>{children}</SeasonRecordGate>;
       }`,
      { filename: "src/season-record-gate.tsx", settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "export default function Gate() { return match(value, handlers); }",
    "const Gate = () => match(value, handlers); export default Gate;",
    "const Gate = () => match(value, handlers); export { Gate };",
    "export const Gate = (() => match(value, handlers)) satisfies Component;",
  ])("accepts a stable component binding: %s", (declaration) => {
    const result = runRule(
      onlyExportComponents,
      `import { match } from "./match";
       ${declaration}
       export const Card = () => <Gate />;`,
      { filename: "src/gate.tsx", settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "export const Card = ({ Gate }) => <Gate />;",
    "export const Card = () => <registry.Gate />;",
    "export const Card = () => <div Gate={Gate} />;",
    "export const Card = () => <div>{Gate}</div>;",
    "export const Card = () => { const Gate = () => <span />; return <Gate />; };",
    "export const Card = () => <div>{Gate()}</div>;",
  ])("rejects unrelated JSX evidence: %s", (consumer) => {
    const result = runRule(
      onlyExportComponents,
      `import { match } from "./match";
       export const Gate = () => match(value, { ready: () => <div /> });
       ${consumer}`,
      { filename: "src/gate.tsx", settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not transfer JSX evidence across a reassignment", () => {
    const result = runRule(
      onlyExportComponents,
      `import { match } from "./match";
       export let Gate = () => match(value, handlers);
       Gate = replacement;
       export const Card = () => <Gate />;`,
      { filename: "src/gate.tsx", settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a utility exported with matcher components", () => {
    const result = runRule(
      onlyExportComponents,
      `import { match } from "./match";
       export const Gate = () => match(value, handlers);
       export const Card = () => <Gate />;
       export const normalize = (text) => text.trim();`,
      { filename: "src/gate.tsx", settings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("non-components");
  });
});
