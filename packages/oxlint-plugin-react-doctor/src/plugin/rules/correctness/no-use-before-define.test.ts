import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUseBeforeDefine } from "./no-use-before-define.js";

describe("runtime Hook providers", () => {
  it.each([
    'import React from "react"; const Namespace = React; const Panel = () => { const selected = Namespace.useMemo(() => later, [later]); const later = 1; return selected; };',
    'import React from "react"; const Panel = () => { const selected = Namespace.useMemo(() => later, [later]); const Namespace = React; const later = 1; return selected; };',
  ])("keeps local namespace aliases outside the direct-import contract: %s", (code) => {
    const result = runRule(noUseBeforeDefine, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each([
    {
      name: "type-only named import",
      code: 'import type { useMemo } from "react";',
    },
    {
      name: "inline type-only import",
      code: 'import { type useMemo, useState } from "react";',
    },
    {
      name: "type-only default import",
      code: 'import type React from "react";',
      callee: "React.useMemo",
    },
    {
      name: "type-only namespace import",
      code: 'import type * as React from "react";',
      callee: "React.useMemo",
    },
    {
      name: "type-only namespace behind an alias",
      code: 'import type * as React from "react"; const Runtime = React;',
      callee: "Runtime.useMemo",
    },
  ])("ignores $name", ({ code, callee = "useMemo" }) => {
    const result = runRule(
      noUseBeforeDefine,
      `${code}
const Panel = () => {
  const selected = ${callee}(() => later, [later]);
  const later = 1;
  return selected;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a runtime import beside erased imports", () => {
    const result = runRule(
      noUseBeforeDefine,
      `import { type useMemo, useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]);
  const later = () => {};
  return selected;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("no-use-before-define", () => {
  it.each([
    {
      name: "callback dependency",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "memo dependency",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later, [later]); const later = 1;
  return null;
};`,
      expected: 1,
    },
    {
      name: "effect dependency",
      code: `import { useEffect } from "react";
const Panel = () => {
  useEffect(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "layout effect dependency",
      code: `import { useLayoutEffect } from "react";
const Panel = () => {
  useLayoutEffect(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "insertion effect dependency",
      code: `import { useInsertionEffect } from "react";
const Panel = () => {
  useInsertionEffect(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "mutable lexical declaration",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]); let later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "uninitialized lexical declaration",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later, [later]); let later;
  return null;
};`,
      expected: 1,
    },
    {
      name: "self dependency",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => selected(), [selected]);
  return null;
};`,
      expected: 1,
    },
    {
      name: "later declarator in one statement",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]), later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "transparent dependency expression",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [(later as () => void)]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "transparent dependency array",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), ([later] as const)); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "transparent Hook call",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = (useCallback(() => later(), [later]) as () => void); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "transparent callback",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(((() => later()) as () => void), [later]); const later = () => {};
  return null;
};`,
      expected: 1,
    },
    {
      name: "already initialized binding",
      code: `import { useCallback } from "react";
const Panel = () => {
  const later = () => {}; const selected = useCallback(() => later(), [later]);
  return null;
};`,
      expected: 0,
    },
    {
      name: "hoisted function",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]); function later() {}
  return null;
};`,
      expected: 0,
    },
    {
      name: "var hoisting",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later, [later]); var later = 1;
  return null;
};`,
      expected: 0,
    },
    {
      name: "deferred callback body",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), []); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "self capture deferred until invocation",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => selected(), []);
  return null;
};`,
      expected: 0,
    },
    {
      name: "deferred dependency element",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => {}, [() => later()]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "member dependency outside finite scope",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later.value, [later.value]); const later = { value: 1 };
  return null;
};`,
      expected: 0,
    },
    {
      name: "computed dependency outside finite scope",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later.value, [later["value"]]); const later = { value: 1 };
  return null;
};`,
      expected: 0,
    },
    {
      name: "destructured declaration outside finite scope",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]); const { later } = source;
  return null;
};`,
      expected: 0,
    },
    {
      name: "class declaration outside finite scope",
      code: `import { useMemo } from "react";
const Panel = () => {
  const selected = useMemo(() => later, [later]); class later {}
  return null;
};`,
      expected: 0,
    },
    {
      name: "logical false branch",
      code: `import { useCallback } from "react";
const Panel = () => {
  false && useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "logical true alternative",
      code: `import { useCallback } from "react";
const Panel = () => {
  true || useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "conditional expression",
      code: `import { useCallback } from "react";
const Panel = () => {
  true ? null : useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "conditional initializer",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = enabled && useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "nested conditional block",
      code: `import { useCallback } from "react";
const Panel = () => {
  if (enabled) { const selected = useCallback(() => later(), [later]); const later = () => {}; }
  return null;
};`,
      expected: 0,
    },
    {
      name: "loop initializer",
      code: `import { useMemo } from "react";
const Panel = () => {
  for (let selected = useMemo(() => later, [later]), later = 1; false;) {}
  return null;
};`,
      expected: 0,
    },
    {
      name: "loop body",
      code: `import { useCallback } from "react";
const Panel = () => {
  for (const item of items) { const selected = useCallback(() => later(), [later]); const later = () => {}; }
  return null;
};`,
      expected: 0,
    },
    {
      name: "unreachable statement after return",
      code: `import { useCallback } from "react";
const Panel = () => {
  return null; const selected = useCallback(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "opaque callback argument",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(callback, [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "noninline dependency list",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), dependencies); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "optional call outside finite scope",
      code: `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback?.(() => later(), [later]); const later = () => {};
  return null;
};`,
      expected: 0,
    },
    {
      name: "earlier declarator in one statement",
      code: `import { useMemo } from "react";
const Panel = () => {
  const later = 1, selected = useMemo(() => later, [later]);
  return null;
};`,
      expected: 0,
    },
    {
      name: "parameter initialized on entry",
      code: `import { useCallback } from "react";
const Panel = (later) => {
  const selected = useCallback(() => later(), [later]);
  return null;
};`,
      expected: 0,
    },
    {
      name: "an imported alias",
      code: `import { useCallback as memoize } from "react"; const Panel = () => { const selected = memoize(() => later(), [later]); const later = () => {}; return null; };`,
      expected: 1,
    },
    {
      name: "a namespace import",
      code: `import * as React from "react"; const Panel = () => { const selected = React.useMemo(() => later, [later]); const later = 1; return null; };`,
      expected: 1,
    },
    {
      name: "a default React import",
      code: `import React from "react"; const Panel = () => { const selected = React.useCallback(() => later(), [later]); const later = () => {}; return null; };`,
      expected: 1,
    },
    {
      name: "a custom Hook owner",
      code: `import { useCallback } from "react"; const useSelection = () => { const selected = useCallback(() => later(), [later]); const later = () => {}; return selected; };`,
      expected: 1,
    },
    {
      name: "multiple later dependencies",
      code: `import { useMemo } from "react"; const Panel = () => { const selected = useMemo(() => first + second, [first, second]); const first = 1; const second = 2; return null; };`,
      expected: 2,
    },
    {
      name: "an outer binding initialized before the component is called",
      code: `import { useCallback } from "react"; const Panel = () => { const selected = useCallback(() => later(), [later]); return null; }; const later = () => {};`,
      expected: 0,
    },
    {
      name: "a nested component closing over an outer binding",
      code: `import { useCallback } from "react"; const Panel = () => { const Inner = () => { const selected = useCallback(() => later(), [later]); return null; }; const later = () => {}; return Inner; };`,
      expected: 0,
    },
    {
      name: "a deferred event callback",
      code: `import { useCallback } from "react"; const Panel = () => { const handleClick = () => { const selected = useCallback(() => later(), [later]); }; const later = () => {}; return null; };`,
      expected: 0,
    },
    {
      name: "a shadowed Hook parameter",
      code: `import { useCallback } from "react"; const Panel = (useCallback) => { const selected = useCallback(() => later(), [later]); const later = () => {}; return null; };`,
      expected: 0,
    },
    {
      name: "a different library with the same API name",
      code: `import { useCallback } from "other-library"; const Panel = () => { const selected = useCallback(() => later(), [later]); const later = () => {}; return null; };`,
      expected: 0,
    },
    {
      name: "an unrelated custom Hook API",
      code: `import { useCallback } from "react"; const Panel = () => { const selected = useCustomCallback(() => later(), [later]); const later = () => {}; return null; };`,
      expected: 0,
    },
    {
      name: "a third-argument dependency API outside finite scope",
      code: `import { useImperativeHandle } from "react"; const Panel = () => { useImperativeHandle(ref, () => later, [later]); const later = {}; return null; };`,
      expected: 0,
    },
    {
      name: "a lower-case non-Hook function",
      code: `import { useCallback } from "react"; const createSelection = () => { const selected = useCallback(() => later(), [later]); const later = () => {}; return selected; };`,
      expected: 0,
    },
    {
      name: "an earlier let without an initializer",
      code: `import { useMemo } from "react"; const Panel=()=>{let later;const selected=useMemo(()=>later,[later]);return null;};`,
      expected: 0,
    },
    {
      name: "an unbound Hook-like global",
      code: `const Panel=()=>{const selected=useCallback(()=>later(),[later]);const later=()=>{};return null;};`,
      expected: 0,
    },
    {
      name: "separate callback and dependency bindings",
      code: `import { useMemo } from "react"; const Panel=()=>{const selected=useMemo(()=>{const later=1;return later;},[later]);const later=2;return null;};`,
      expected: 1,
    },
    {
      name: "a same-name type and value namespace",
      code: `import { useMemo } from "react"; const Panel=()=>{const selected=useMemo(()=>later,[later]);const later=1;interface later{};return null;};`,
      expected: 1,
    },
    {
      name: "a sparse dependency array",
      code: `import { useMemo } from "react"; const Panel=()=>{const selected=useMemo(()=>later,[,null,later]);const later=1;return null;};`,
      expected: 1,
    },
    {
      name: "a redundant but eagerly read dependency",
      code: `import { useMemo } from "react"; const Panel=()=>{const selected=useMemo(()=>0,[later]);const later=1;return null;};`,
      expected: 1,
    },
  ])("$name", ({ code, expected }) => {
    const result = runRule(noUseBeforeDefine, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.nodeType).toBe("Identifier");
      expect(diagnostic.message).toContain("before its local");
    }
  });

  it("underlines the eager dependency instead of the deferred capture", () => {
    const code = `import { useCallback } from "react";
const Panel = () => {
  const selected = useCallback(() => later(), [later]); const later = () => {};
  return null;
};`;
    const dependencyOffset = code.indexOf("[later]") + "[".length;
    const precedingLines = code.slice(0, dependencyOffset).split("\n");
    const result = runRule(noUseBeforeDefine, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        line: precedingLines.length,
        column: precedingLines.at(-1)?.length,
        nodeType: "Identifier",
      }),
    ]);
  });
});
