import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingConditionalRender } from "./rendering-conditional-render.js";

const cases = [
  {
    name: "local string and undefined returns",
    filename: "local-string-and-undefined-returns.tsx",
    source: `function formatSize(value: number): string | undefined {
  if (value < 0) return undefined;
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: { curated: [], upstream: [] },
  },
  {
    name: "local direct string literal return",
    filename: "local-direct-string-literal-return.tsx",
    source: `function formatSize(value: number) {
  if (!value) return "";
  return "ready";
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: { curated: [], upstream: [] },
  },
  {
    name: "numeric zero fallback",
    filename: "numeric-zero-fallback.tsx",
    source: `function formatSize(value: number) {
  if (!value) return 0;
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "type assertion does not prove string",
    filename: "type-assertion-does-not-prove-string.tsx",
    source: `function formatSize(value: number): string {
  if (!value) return 0 as unknown as string;
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "generic type only return claim",
    filename: "generic-type-only-return-claim.tsx",
    source: `function formatSize<T = string>(value: number): T {
  return (value || 0) as T;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "async formatter outside exception",
    filename: "async-formatter-outside-exception.tsx",
    source: `async function formatSize(value: number) {
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "generator formatter outside exception",
    filename: "generator-formatter-outside-exception.tsx",
    source: `function* formatSize(value: number) {
  yield value;
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "visible function rebinding",
    filename: "visible-function-rebinding.tsx",
    source: `function formatSize(value: number): string | number {
  return \`\${value} B\`;
}
formatSize = () => 0;

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "direct eval rebinds private function",
    filename: "direct-eval-rebinds-private-function.tsx",
    source: `function formatSize(value: number): string | number {
  return \`\${value} B\`;
}
(eval)("formatSize = () => 0");

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "deferred same function rebinding",
    filename: "deferred-same-function-rebinding.tsx",
    source: `function formatSize(value: number): string | number {
  formatSize = () => 0;
  return \`\${value} B\`;
}
formatSize(1);

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "shadowed undefined is zero",
    filename: "shadowed-undefined-is-zero.tsx",
    source: `function formatSize(value: number) {
  const undefined = 0;
  if (!value) return undefined;
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "provider import is opaque",
    filename: "provider-import-is-opaque.tsx",
    source: `import { formatSize } from "./formatter";

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "opaque parameter formatter",
    filename: "opaque-parameter-formatter.tsx",
    source: `export default function Example(value: number, formatSize: (value: number) => unknown) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "nested string return does not prove owner",
    filename: "nested-string-return-does-not-prove-owner.tsx",
    source: `function formatSize(value: number) {
  const helper = () => \`\${value} B\`;
  void helper;
  return 0;
}

export default function Example(value: number) {
  const size = formatSize(value);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "same file independent numeric neighbor",
    filename: "same-file-independent-numeric-neighbor.tsx",
    source: `function formatSize(value: number) {
  return \`\${value} B\`;
}

export default function Example(value: number) {
  const size = formatSize(value);
  const itemCount = 0;
  return <div>{size && <span />}{itemCount && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
  {
    name: "classic global formatter rebound",
    filename: "classic-global-formatter-rebound.jsx",
    source: `function formatSize(bytes) {
  return \`\${bytes} B\`;
}

globalThis.formatSize = () => 0;

function Example({ bytes }) {
  const size = formatSize(bytes);
  return <div>{size && <span />}</div>;
}
`,
    expected: {
      curated: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
      upstream: [
        "Your users see a stray '0' on screen when a number before `&&` is zero, so use `value > 0`, `Boolean(value)`, or a ternary instead.",
      ],
    },
  },
] as const;

describe("rendering conditional guards from local string formatters", () => {
  it.each(cases)("$name", ({ source, expected, filename }) => {
    for (const mode of ["curated", "upstream"] as const) {
      const result = runRule(renderingConditionalRender, source, {
        filename,
        settings: { "react-doctor": { portedRuleMode: mode } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map(({ message }) => message).sort()).toEqual(expected[mode]);
    }
  });
});
