import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";

describe("no-derived-state", () => {
  describe("valid — accumulators over previous state stay quiet", () => {
    it("does not flag a Set accumulator grown through a functional updater (ink TUI regression)", () => {
      const code = `
import { useEffect, useState } from "react";
const DiagnosticList = ({ selectedRuleKey }) => {
  const [readRuleKeys, setReadRuleKeys] = useState(() => new Set());
  useEffect(() => {
    if (!selectedRuleKey) return;
    setReadRuleKeys((previous) =>
      previous.has(selectedRuleKey) ? previous : new Set(previous).add(selectedRuleKey),
    );
  }, [selectedRuleKey]);
  return readRuleKeys.size;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag an array accumulator appending to its previous value", () => {
      const code = `
import { useEffect, useState } from "react";
const History = ({ selection }) => {
  const [visited, setVisited] = useState([]);
  useEffect(() => {
    setVisited((previous) => [...previous, selection]);
  }, [selection]);
  return visited.length;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag a counter accumulator adding a prop to its previous value", () => {
      const code = `
import { useEffect, useState } from "react";
const CountAccumulator = ({ count }) => {
  const [total, setTotal] = useState(0);
  useEffect(() => {
    setTotal((previous) => previous + count);
  }, [count]);
  return total;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag an updater whose block body reads its parameter", () => {
      const code = `
import { useEffect, useState } from "react";
const AttemptCounter = ({ count }) => {
  const [, setAttempts] = useState(0);
  useEffect(() => {
    setAttempts((previous) => {
      return previous + count;
    });
  }, [count]);
  return null;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("invalid — copying props/state into state stays reported", () => {
    it("flags copying a prop into state without reading the previous value", () => {
      const code = `
import { useEffect, useState } from "react";
const Form = ({ firstName, lastName }) => {
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return fullName;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain("fullName");
    });

    it("flags a functional updater that ignores its parameter", () => {
      const code = `
import { useEffect, useState } from "react";
const Form = ({ firstName }) => {
  const [displayName, setDisplayName] = useState("");
  useEffect(() => {
    setDisplayName(() => firstName);
  }, [firstName]);
  return displayName;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags a spread-only object merge whose new field derives from props", () => {
      const code = `
import { useEffect, useState } from "react";
const Form = ({ firstName, lastName }) => {
  const [formData, setFormData] = useState({ title: "Dr.", fullName: "" });
  useEffect(() => {
    setFormData((previous) => ({
      ...previous,
      fullName: firstName + " " + lastName,
    }));
  }, [firstName, lastName]);
  return formData.fullName;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("flags an updater whose parameter read is shadowed by an inner binding", () => {
      const code = `
import { useEffect, useState } from "react";
const Form = ({ names }) => {
  const [joined, setJoined] = useState("");
  useEffect(() => {
    setJoined(() => names.map((previous) => previous.trim()).join(" "));
  }, [names]);
  return joined;
};
`;
      const result = runRule(noDerivedState, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });
});

describe("no-derived-state — local helper return provenance", () => {
  it.each([
    [
      "an impure function declaration",
      `function derive(firstName, lastName) {
        console.log("derive");
        return firstName + " " + lastName;
      }`,
    ],
    ["an arrow function", `const derive = (firstName, lastName) => firstName + " " + lastName;`],
    ["a closure", `const derive = () => firstName + " " + lastName;`],
    [
      "a useCallback closure",
      `const derive = useCallback(
        () => firstName + " " + lastName + firstName,
        [firstName, lastName],
      );`,
    ],
  ])("flags state copied through %s", (_scenarioLabel, helperSource) => {
    const result = runRule(
      noDerivedState,
      `
function Form() {
  const [firstName] = useState("Dwayne");
  const [lastName] = useState("Johnson");
  const [fullName, setFullName] = useState("");
  ${helperSource}
  useEffect(() => {
    setFullName(derive(firstName, lastName));
  }, [firstName, lastName, derive]);
  return fullName;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["an effect-local arrow", `const derive = () => firstName + " " + lastName;`],
    [
      "an effect-local function declaration",
      `function derive() {
        return firstName + " " + lastName;
      }`,
    ],
  ])("flags state copied through %s", (_scenarioLabel, helperSource) => {
    const result = runRule(
      noDerivedState,
      `
function Form() {
  const [firstName] = useState("Dwayne");
  const [lastName] = useState("Johnson");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    ${helperSource}
    setFullName(derive());
  }, [firstName, lastName]);
  return fullName;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-derived-state — one-hop module helper summaries", () => {
  it("flags a pure module helper and ignores an unused opaque argument", () => {
    const result = runRule(
      noDerivedState,
      `
const selectVisible = (items, ignoredMeasurement) =>
  items.filter((item) => item.visible);

function List({ items }) {
  const measurementRef = useRef(null);
  const [visibleItems, setVisibleItems] = useState([]);
  useEffect(() => {
    setVisibleItems(selectVisible(items, measurementRef));
  }, [items]);
  return visibleItems.length;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a used helper argument reads a ref", () => {
    const result = runRule(
      noDerivedState,
      `
const buildLabel = (value, measurement) => value + measurement.current;

function Field({ value }) {
  const measurementRef = useRef(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(buildLabel(value, measurementRef));
  }, [value]);
  return label;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags deterministic global transforms returned by a module helper", () => {
    const result = runRule(
      noDerivedState,
      `
const derive = (value) => JSON.stringify({ rounded: Math.floor(value) });

function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(derive(value));
  }, [value]);
  return label;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["incomplete returns", `const derive = (value) => { if (value) return value.trim(); };`],
    ["side effects", `const derive = (value) => { analytics.track(value); return value.trim(); };`],
    ["mutations", `const derive = (value) => { value.label = "changed"; return value; };`],
    ["mutable free variables", `let suffix = "!"; const derive = (value) => value + suffix;`],
    ["recursive calls", `const derive = (value) => value ? derive(value.slice(1)) : value;`],
    [
      "multi-hop calls",
      `const normalize = (value) => value.trim(); const derive = (value) => normalize(value);`,
    ],
    ["nondeterministic external values", `const derive = (value) => value + Math.random();`],
    ["async functions", `const derive = async (value) => value.trim();`],
    ["generator functions", `function* derive(value) { return value.trim(); }`],
    [
      "shadowed global namespaces",
      `const Math = { floor: (value) => readExternal(value) }; const derive = (value) => Math.floor(value);`,
    ],
    [
      "imported global names",
      `import { JSON } from "./opaque"; const derive = (value) => JSON.stringify(value);`,
    ],
    [
      "unknown namespace members",
      `const derive = (value) => Math.projectSpecificTransform(value);`,
    ],
  ])("stays silent for %s", (_scenarioLabel, helperSource) => {
    const result = runRule(
      noDerivedState,
      `
${helperSource}
function Field({ value }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(derive(value));
  }, [value]);
  return label;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves direct member, boolean, reset, and filter derivations", () => {
    const directExpressions = [
      "levels.length",
      "isOpen",
      "photos.length - 1",
      "messages.filter((message) => message.visible)",
    ];
    for (const directExpression of directExpressions) {
      const result = runRule(
        noDerivedState,
        `
function Example({ levels, isOpen, photos, messages }) {
  const [derived, setDerived] = useState(null);
  useEffect(() => {
    setDerived(${directExpression});
  }, [levels, isOpen, photos, messages]);
  return derived;
}
`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not broaden mixed prop, ref, and independently edited state", () => {
    const result = runRule(
      noDerivedState,
      `
function MailingField({ value }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(value + (inputRef.current?.dataset.suffix ?? ""));
  }, [value]);
  return <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} />;
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
