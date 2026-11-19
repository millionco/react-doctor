import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

const source = `
  import React from "react";

  export const Announcement = React.memo(
    (props: { message?: string; ready?: boolean }): React.ReactElement | null => {
      const { message, ready } = props;
      const [visible, setVisible] = React.useState(message);
      React.useEffect(() => {
        if (!message) return;
        setVisible(message);
        recordDisplay();
      }, [message]);
      if (!visible) return null;
      return <p>{visible}</p>;
    },
  );
`;

describe("retained optional props in effects", () => {
  it.each([
    source,
    source
      .replace("{ message, ready }", "{ message: announcement, ready }")
      .replace("React.useState(message)", "React.useState(announcement)")
      .replace("!message", "!announcement")
      .replace("setVisible(message)", "setVisible(announcement)")
      .replace("[message]", "[announcement]"),
  ])("preserves the last visible value when the prop is absent", (code) => {
    const result = runRule(noDerivedState, code, { filename: "src/Announcement.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    { name: "an unconditional copy", code: source.replace("        if (!message) return;\n", "") },
    {
      name: "clearing when the message is absent",
      code: source.replace(
        "if (!message) return;",
        "if (!message) { setVisible(undefined); return; }",
      ),
    },
    { name: "a different guard", code: source.replace("if (!message)", "if (!ready)") },
    { name: "a different dependency", code: source.replace("[message]", "[ready]") },
    {
      name: "a different initial state",
      code: source.replace("React.useState(message)", 'React.useState("")'),
    },
    {
      name: "an always-present prop",
      code: source.replace("message?: string", 'message: "known"'),
    },
    {
      name: "discarded JSX",
      code: source.replace(
        "return <p>{visible}</p>;",
        "const unused = <p>{visible}</p>; return null;",
      ),
    },
    {
      name: "unreachable JSX",
      code: source.replace(
        "return <p>{visible}</p>;",
        "if (false) return <p>{visible}</p>; return null;",
      ),
    },
    {
      name: "an escaped setter",
      code: source.replace("React.useEffect(", "recordSetter(setVisible); React.useEffect("),
    },
    {
      name: "a replaced React effect",
      code: source.replace(
        'import React from "react";',
        'import React from "react"; React.useEffect = callSynchronously;',
      ),
    },
  ])("preserves the warning for $name", ({ code }) => {
    const result = runRule(noDerivedState, code, { filename: "src/Announcement.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
