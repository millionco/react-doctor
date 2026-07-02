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
