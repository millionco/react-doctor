import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change message", () => {
  it.each([
    {
      name: "an adjustment that can leave a previous choice in rendered output",
      writeLine: 6,
      code: `
import { useEffect, useState } from "react";
const ChoicePanel = ({ category }) => {
  const [choice, setChoice] = useState("first");
  useEffect(() => {
    setChoice("first");
  }, [category]);
  return <button onClick={() => setChoice("second")}>{category}: {choice}</button>;
};
`,
    },
    {
      name: "a write that preserves the only possible state value",
      writeLine: 6,
      code: `
import { useEffect, useState } from "react";
const GroupMarker = ({ groupId }) => {
  const [marker, setMarker] = useState(0);
  useEffect(() => {
    setMarker(0);
  }, [groupId]);
  return <span data-group={groupId}>{marker}</span>;
};
`,
    },
    {
      name: "a write to state that does not participate in rendered output",
      writeLine: 6,
      code: `
import { useEffect, useState } from "react";
const GroupLabel = ({ groupId }) => {
  const [, setMarker] = useState(0);
  useEffect(() => {
    setMarker(0);
  }, [groupId]);
  return <span>{groupId}</span>;
};
`,
    },
    {
      name: "a forwarded write in a layout effect",
      writeLine: 7,
      code: `
import { useLayoutEffect, useState } from "react";
const write = (setter, value) => setter(value);
const Editor = ({ documentId }) => {
  const [value, setValue] = useState("");
  useLayoutEffect(() => {
    write(setValue, "");
  }, [documentId]);
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
};
`,
    },
  ])("qualifies the possible outcomes for $name", ({ code, writeLine }) => {
    const result = runRule(noAdjustStateOnPropChange, code, { includeLocations: true });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        message: "Adjusting state in an effect after a prop changes can trigger another render.",
        nodeType: "CallExpression",
        line: writeLine,
        column: 4,
      },
    ]);
  });

  it("keeps an effect-free render quiet", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `const GroupMarker = ({ groupId }) => <span data-group={groupId}>{0}</span>;`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
