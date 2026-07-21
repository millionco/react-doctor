import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import type { Rule } from "../utils/rule.js";
import { rerenderMemoWithDefaultValue } from "./performance/rerender-memo-with-default-value.js";
import { exhaustiveDeps } from "./react-builtins/exhaustive-deps.js";
import { noEffectWithFreshDeps } from "./state-and-effects/no-effect-with-fresh-deps.js";

interface ForwardedFreshRuleCase {
  readonly expectedMessageFragment: string;
  readonly name: string;
  readonly rule: Rule;
}

const callerFreshnessRuleCases: ForwardedFreshRuleCase[] = [
  {
    expectedMessageFragment: "dependency inside this custom Hook changes every render",
    name: "no-effect-with-fresh-deps",
    rule: noEffectWithFreshDeps,
  },
  {
    expectedMessageFragment: "reaches a Hook dependency inside this custom Hook",
    name: "exhaustive-deps",
    rule: exhaustiveDeps,
  },
];

const defaultFreshnessRuleCases: ForwardedFreshRuleCase[] = [
  ...callerFreshnessRuleCases,
  {
    expectedMessageFragment: "custom Hook default creates a new",
    name: "rerender-memo-with-default-value",
    rule: rerenderMemoWithDefaultValue,
  },
];

const runRuleWithFilename = (rule: Rule, code: string, filename: string) =>
  runRule(rule, code, { filename });

describe("custom Hook forwarded fresh dependencies", () => {
  let temporaryDirectory = "";
  let entryFilename = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "rd-custom-hook-forwarded-fresh-deps-"),
    );
    entryFilename = path.join(temporaryDirectory, "src", "picker.tsx");
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const writeFixtureFile = (relativePath: string, contents: string): string => {
    const absolutePath = path.join(temporaryDirectory, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf8");
    return absolutePath;
  };

  const installCrossFileHookChain = (): void => {
    writeFixtureFile(
      "src/use-isomorphic-layout-effect.ts",
      `import { useEffect, useLayoutEffect } from "react";
export const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;
`,
    );
    writeFixtureFile(
      "src/use-document-events.ts",
      `import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";
export const useDocumentEvents = (callback, dependencies) => {
  useIsomorphicLayoutEffect(callback, dependencies);
};
`,
    );
    writeFixtureFile(
      "src/use-picker.ts",
      `import { useDocumentEvents } from "./use-document-events";
export const usePicker = ({ inputRef, triggerRefs = [inputRef] }) => {
  useDocumentEvents(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
`,
    );
  };

  for (const ruleCase of callerFreshnessRuleCases) {
    it(`${ruleCase.name} reports a fresh caller argument forwarded by a same-file Hook`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = ({ triggerRefs }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  usePicker({ triggerRefs: [inputRef] });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });

    it(`${ruleCase.name} follows a fresh caller argument through cross-file local Hooks`, () => {
      installCrossFileHookChain();
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { usePicker } from "./use-picker";
export const Picker = ({ inputRef }) => {
  usePicker({ inputRef, triggerRefs: [inputRef] });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });

    it(`${ruleCase.name} stays quiet for an inline selector consumed by useMemo`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { createContext, useContext, useMemo } from "react";
const SizeContext = createContext(undefined);
const useSize = (customSize) => {
  const size = useContext(SizeContext);
  return useMemo(() => customSize(size), [customSize, size]);
};
export const Button = ({ customSize }) => {
  const size = useSize((contextSize) => customSize ?? contextSize);
  return <button data-size={size} />;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }

  for (const ruleCase of defaultFreshnessRuleCases) {
    it(`${ruleCase.name} reports an omitted fresh default forwarded by a same-file Hook`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = ({ inputRef, triggerRefs = [inputRef] }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  usePicker({ inputRef });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });

    it(`${ruleCase.name} follows an omitted fresh default through cross-file local Hooks`, () => {
      installCrossFileHookChain();
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { usePicker } from "./use-picker";
export const Picker = ({ inputRef }) => {
  usePicker({ inputRef });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });

    it(`${ruleCase.name} resolves a named Hook re-exported after its default declaration`, () => {
      writeFixtureFile(
        "src/use-picker.ts",
        `import { useEffect } from "react";
export default function usePicker({ inputRef, triggerRefs = [inputRef] }) {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
}
export { usePicker };
`,
      );
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { usePicker } from "./use-picker";
export const Picker = ({ inputRef }) => {
  usePicker({ inputRef });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });

    it(`${ruleCase.name} resolves a default-imported Hook`, () => {
      writeFixtureFile(
        "src/use-picker.ts",
        `import { useEffect } from "react";
export default function usePicker({ inputRef, triggerRefs = [inputRef] }) {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
}
`,
      );
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import usePicker from "./use-picker";
export const Picker = ({ inputRef }) => {
  usePicker({ inputRef });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain(ruleCase.expectedMessageFragment);
    });
  }

  for (const ruleCase of defaultFreshnessRuleCases) {
    it.each([
      [
        "useMemo result",
        `const memoizedRefs = useMemo(() => [inputRef], [inputRef]);
  usePicker({ triggerRefs: memoizedRefs });`,
      ],
      ["module constant", `usePicker({ triggerRefs: MODULE_REFS });`],
    ])(`${ruleCase.name} stays quiet for a stable %s`, (_stableSource, componentBody) => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect, useMemo } from "react";
const MODULE_REFS = [];
const usePicker = ({ triggerRefs }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  ${componentBody}
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      [
        "reassigned",
        `triggerRefs = stableRefs;
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);`,
      ],
      [
        "mutated",
        `triggerRefs.push(stableRefs[0]);
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);`,
      ],
      [
        "conditionally replaced",
        `const actualRefs = enabled ? triggerRefs : stableRefs;
  useEffect(() => {
    void actualRefs;
  }, [actualRefs]);`,
      ],
    ])(`%s stays quiet when the forwarded value is %s`, (_boundary, hookBody) => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const STABLE_REFS = [];
const usePicker = ({ triggerRefs, stableRefs = STABLE_REFS, enabled = true }) => {
  ${hookBody}
};
export const Picker = ({ inputRef }) => {
  usePicker({ triggerRefs: [inputRef] });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet for a bare-package custom Hook`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useExternalPicker } from "external-picker";
export const Picker = ({ inputRef }) => {
  useExternalPicker({ triggerRefs: [inputRef] });
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet when only stable spread elements reach built-in deps`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = (triggerRefs) => {
  useEffect(() => {}, [...triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  usePicker([inputRef]);
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet when a positional spread makes the argument unknown`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = (triggerRefs = []) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  const argumentsForPicker = Math.random() > 0.5 ? [] : [[inputRef]];
  usePicker(...argumentsForPicker);
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet after an object argument property is overwritten`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const STABLE_REFS = [];
const usePicker = ({ triggerRefs }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  const pickerOptions = { triggerRefs: [inputRef] };
  pickerOptions.triggerRefs = STABLE_REFS;
  usePicker(pickerOptions);
  return null;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet when the custom Hook call is deferred to an event handler`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = ({ triggerRefs }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  const handleClick = () => usePicker({ triggerRefs: [inputRef] });
  return <button onClick={handleClick}>open</button>;
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet when the custom Hook call is unreachable`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = ({ triggerRefs }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = ({ inputRef }) => {
  return null;
  usePicker({ triggerRefs: [inputRef] });
};
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`${ruleCase.name} stays quiet for a fresh default in an uncalled custom Hook`, () => {
      const result = runRuleWithFilename(
        ruleCase.rule,
        `import { useEffect } from "react";
const usePicker = ({ inputRef, triggerRefs = [inputRef] }) => {
  useEffect(() => {
    void triggerRefs;
  }, [triggerRefs]);
};
export const Picker = () => null;
`,
        entryFilename,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }
});
