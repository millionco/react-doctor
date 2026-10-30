import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCurrentInRender } from "./no-ref-current-in-render.js";

describe("no-ref-current-in-render — stored method local bindings", () => {
  it.each([
    [
      "stored-arrow-local-let",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; count += 1; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "stored-function-local-var",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: function () { var count = 0; count += 1; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "stored-block-local-let",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { if (true) { let count = 1; return count; } return 0; } };
 return null;
};
`,
      0,
    ],
    [
      "stored-prop-capture",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = props.count; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "render-mutable-capture",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 let count = 1; if (valueRef.current === null) valueRef.current = { read: () => { let selected = count; return selected; } };
 return null;
};
`,
      1,
    ],
    [
      "module-mutable-capture",
      `let count = 1;
import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let selected = count; return selected; } };
 return null;
};
`,
      1,
    ],
    [
      "immediately-invoked-initialization",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = (() => { let count = 1; return { read: () => count }; })();
 return null;
};
`,
      1,
    ],
    [
      "computed-prop-key",
      `import { useRef } from "react";
const Panel = (props: { label: string }) => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { [props.label]: () => { let count = 1; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "wrong-null-guard",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current !== null) valueRef.current = { read: () => { let count = 1; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "stored-const-legacy-control",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { const count = 1; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "same-name-shadowed-local",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 const count = props.count; if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "nested-immediate-function-deferred-profile",
      `import { useRef } from "react";
const Panel = () => {
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => (() => { let count = 1; return count; })() };
 return null;
};
`,
      1,
    ],
    [
      "stored-method-local-const-alias",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = 1; const selected = count; return selected; } };
 return null;
};
`,
      0,
    ],
    [
      "stored-method-local-loop",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; for (let index = 0; index < 2; index += 1) count += index; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "local-binding-shadows-render-mutable-binding",
      `import { useRef } from "react";
const Panel = () => {
 let count = 1;
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; return count; } };
 return null;
};
`,
      0,
    ],
    [
      "stored-function-default-prop-capture",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: (count = props.count) => { let selected = count; return selected; } };
 return null;
};
`,
      1,
    ],
    [
      "stored-function-render-const-prop-alias",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
 const count = props.count;
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let selected = count; return selected; } };
 return null;
};
`,
      1,
    ],
    [
      "named-function-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: function readCount() { let count = 0; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "async-function-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: async () => { let count = 0; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "generator-function-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: function* () { let count = 0; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "method-shorthand-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read() { let count = 0; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "getter-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { get read() { let count = 0; return () => count; } };
 return null;
};
`,
      1,
    ],
    [
      "computed-literal-key-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { ["read"]: () => { let count = 0; return count; } };
 return null;
};
`,
      1,
    ],
    [
      "function-identifier-alias-outside-finite-profile",
      `import { useRef } from "react";
const Panel = () => {
 const read = () => { let count = 0; return count; };
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read };
 return null;
};
`,
      1,
    ],
    [
      "stored-function-transparent-wrapper",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: (() => { let count = 0; return count; }) satisfies (() => number) };
 return null;
};
`,
      0,
    ],
    [
      "stored-object-transparent-wrapper",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = ({ read: () => { let count = 0; return count; } } satisfies { read: () => number });
 return null;
};
`,
      0,
    ],
    [
      "null-guard-ref-alias",
      `import { useRef } from "react"; const Panel = () => { const valueRef = useRef<{ read: () => number } | null>(null); const selectedRef = valueRef; if (selectedRef.current === null) selectedRef.current = { read: () => { let count = 0; return count; } }; return null; };`,
      0,
    ],
    [
      "escaped-ref-remains-reported",
      `import { useRef } from "react"; declare const publish: (value: unknown) => void; const Panel = () => { const valueRef = useRef<{ read: () => number } | null>(null); publish(valueRef); if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; return count; } }; return null; };`,
      1,
    ],
    [
      "captured-local-function-prop-alias",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
 const readCount = () => props.count;
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let selected = readCount(); return selected; } };
 return null;
};
`,
      1,
    ],
    [
      "member-initialization-still-input-dependent",
      `import { useRef } from "react";
const Panel = (props: { count: number }) => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { let count = 0; return count; }, count: props.count };
 return null;
};
`,
      1,
    ],
    [
      "stored-function-param-owned",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: (count: number) => { let selected = count; return selected; } };
 return null;
};
`,
      0,
    ],
    [
      "nested-deferred-local-owned-by-another-function",
      `import { useRef } from "react";
const Panel = () => {
\x20
 const valueRef = useRef<{ read: () => number } | null>(null);
 if (valueRef.current === null) valueRef.current = { read: () => { const later = () => { let count = 0; return count; }; return later(); } };
 return null;
};
`,
      1,
    ],
  ])("%s", (_name, code, expectedCount) => {
    const result = runRule(noRefCurrentInRender, code, {
      filename: "deferred-method.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:19"],
        },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
