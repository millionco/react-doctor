import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("prefer-use-effect-event");

describe("prefer-use-effect-event", () => {
  it("flags the canonical setTimeout shape (Vercel `advanced-use-latest`)", async () => {
    // https://react.dev/learn/separating-events-from-effects
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-settimeout", {
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onSearch");
    expect(hits[0].message).toContain("setTimeout");
  });

  it("flags an addEventListener handler that calls a prop callback", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-add-listener", {
      files: {
        "src/Listener.tsx": `import { useEffect } from "react";

export const Listener = ({ onKey }: { onKey: (key: string) => void }) => {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event.key);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onKey]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    // Single dep array — needs >= 2 deps for the rule to fire.
    expect(hits).toHaveLength(0);
  });

  it("flags an addEventListener handler with multiple deps including the callback", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-multi-deps", {
      files: {
        "src/Listener.tsx": `import { useEffect, useState } from "react";

export const Listener = ({ onKey }: { onKey: (key: string, prefix: string) => void }) => {
  const [prefix, setPrefix] = useState("");
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event.key, prefix);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefix, onKey]);
  return <input value={prefix} onChange={(event) => setPrefix(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onKey");
    expect(hits[0].message).toContain("addEventListener");
  });

  it("flags a store.subscribe handler that calls a prop callback", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-subscribe", {
      files: {
        "src/Logger.tsx": `import { useEffect, useState } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };

export const Logger = ({ onChange }: { onChange: (value: number) => void }) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => onChange(value));
    return unsubscribe;
  }, [value, onChange]);
  return <button onClick={() => setValue(value + 1)}>{value}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onChange");
    expect(hits[0].message).toContain("subscribe");
  });

  it("does NOT flag a callback that is read at the effect's top level (true reactive read)", async () => {
    // The article is explicit: only non-reactive reads should move into
    // useEffectEvent. If the callback is part of the start-sync expression
    // itself, it really should be in deps.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-top-level", {
      files: {
        "src/Mount.tsx": `import { useEffect, useState } from "react";

export const Mount = ({ onMount }: { onMount: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    onMount(query);
  }, [query, onMount]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the dep is not function-typed (state, plain identifier)", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-non-fn-dep", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

declare const log: (count: number) => void;

export const Counter = () => {
  const [count, setCount] = useState(0);
  const [base, setBase] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => log(count + base), 100);
    return () => clearTimeout(id);
  }, [count, base]);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the dep array has fewer than 2 elements (single-dep effect doesn't benefit)", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-single-dep", {
      files: {
        "src/Single.tsx": `import { useEffect } from "react";

export const Single = ({ onTick }: { onTick: () => void }) => {
  useEffect(() => {
    const id = setInterval(() => onTick(), 1000);
    return () => clearInterval(id);
  }, [onTick]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(0);
  });

  it("flags a `useCallback`-bound local that is only invoked from a sub-handler", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-usecallback", {
      files: {
        "src/Spy.tsx": `import { useCallback, useEffect, useState } from "react";

declare const audit: (event: string) => void;

export const Spy = ({ tag }: { tag: string }) => {
  const [count, setCount] = useState(0);
  const log = useCallback(() => audit(tag), [tag]);
  useEffect(() => {
    const id = setInterval(() => log(), 1000);
    return () => clearInterval(id);
  }, [count, log]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("log");
    expect(hits[0].message).toContain("setInterval");
  });

  it("fires when reactMajorVersion is explicitly 19", async () => {
    // useEffectEvent landed in React 19. The rule should still fire when
    // the project is detected as React 19 — same diagnostic as the default
    // (null) path.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-react-19", {
      reactVersion: "^19.0.0",
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", {
      reactMajorVersion: 19,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onSearch");
  });

  it("does NOT fire when reactMajorVersion is below the useEffectEvent threshold (React 18)", async () => {
    // Recommending useEffectEvent on React 18 produces noisy diagnostics
    // for users who don't have the API. The rule is gated to React >= 19.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-react-18", {
      reactVersion: "^18.3.0",
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", {
      reactMajorVersion: 18,
    });
    expect(hits).toHaveLength(0);
  });

  it("does NOT fire when reactMajorVersion is React 17", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-react-17", {
      reactVersion: "^17.0.0",
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", {
      reactMajorVersion: 17,
    });
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a useEffect inside a nested helper that closes over an OUTER component's prop", async () => {
    // The empty-frame barrier prevents the inner non-component helper
    // from inheriting the outer component's prop set. `value` is closed
    // over by Inner via lexical scope, but it is NOT a prop of Inner —
    // so the rule must not fire there.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ value }: { value: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  function inner() {
    useEffect(() => {
      const id = setTimeout(() => value(query), 300);
      return () => clearTimeout(id);
    }, [query, value]);
  }
  inner();
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(0);
  });

  it("flags a `function handler() {...}` declaration (FunctionDeclaration shape, not just `const handler = ...`)", async () => {
    // Regression: `findSubHandlerForEnclosingFunction` previously only
    // recognized `const handler = ...` (VariableDeclarator). The
    // FunctionDeclaration shape was a silent FN.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-fn-decl", {
      files: {
        "src/Listener.tsx": `import { useEffect, useState } from "react";

export const Listener = ({ onKey }: { onKey: (key: string) => void }) => {
  const [prefix, setPrefix] = useState("");
  useEffect(() => {
    function handler(event: KeyboardEvent) { onKey(event.key + prefix); }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefix, onKey]);
  return <input value={prefix} onChange={(event) => setPrefix(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onKey");
  });

  it("flags an `let h; h = (e) => ...` reassignment shape (AssignmentExpression binding)", async () => {
    // Regression: the AssignmentExpression form was a silent FN
    // alongside the FunctionDeclaration shape.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-assign", {
      files: {
        "src/Listener.tsx": `import { useEffect, useState } from "react";

export const Listener = ({ onKey }: { onKey: (key: string) => void }) => {
  const [prefix, setPrefix] = useState("");
  useEffect(() => {
    let handler: (event: KeyboardEvent) => void;
    handler = (event) => onKey(event.key + prefix);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prefix, onKey]);
  return <input value={prefix} onChange={(event) => setPrefix(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onKey");
  });

  it("does NOT flag a scalar destructured prop only read inside a sub-handler (Bugbot #162)", async () => {
    // Regression: previously every destructured prop satisfied the
    // function-typed gate. A component like \`({ onSearch, prefix })\`
    // would get \`prefix\` (a string) flagged with a 'wrap in
    // useEffectEvent' message — semantically wrong for non-functions.
    // Now only \`on[A-Z]\`-shaped prop names pass; \`prefix\` does not.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-scalar-prop", {
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({
  onSearch,
  prefix,
}: {
  onSearch: (query: string) => void;
  prefix: string;
}) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(\`\${prefix}\${query}\`), 300);
    return () => clearTimeout(id);
  }, [query, prefix, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    // \`onSearch\` (an on*-named prop) IS validly flagged.
    // \`prefix\` (a scalar string) MUST NOT be flagged.
    expect(hits.length).toBe(1);
    expect(hits[0].message).toContain("onSearch");
    expect(hits[0].message).not.toContain("prefix");
  });

  it("DOES fire when reactMajorVersion is unknown (null) — assume latest React, apply every rule", async () => {
    // When detection fails (custom resolver, monorepo override, mid-clone
    // state) we optimistically treat the project as if it were on the
    // latest React major and apply every rule, including
    // `prefer-newer-api` ones like `prefer-use-effect-event`. Hiding the
    // suggestion would silently degrade the scan whenever React resolves
    // through an unusual path. See `filterRulesByReactMajor` in
    // oxlint-config.ts.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-unknown-version", {
      files: {
        "src/SearchInput.tsx": `import { useEffect, useState } from "react";

export const SearchInput = ({ onSearch }: { onSearch: (q: string) => void }) => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onSearch(query), 300);
    return () => clearTimeout(id);
  }, [query, onSearch]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", {
      reactMajorVersion: null,
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
