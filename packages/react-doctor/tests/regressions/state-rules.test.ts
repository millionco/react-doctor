import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "../../src/utils/run-oxlint.js";
import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-state-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const collectRuleHits = async (
  projectDir: string,
  ruleId: string,
  reactMajorVersion: number | null = null,
): Promise<Array<{ filePath: string; message: string }>> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    hasTypeScript: true,
    framework: "unknown",
    hasReactCompiler: false,
    hasTanStackQuery: false,
    reactMajorVersion,
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
    }));
};

describe("no-direct-state-mutation", () => {
  it("flags push/pop/splice/sort/reverse and member assignment on useState values", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-pos", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const [profile, setProfile] = useState({ tags: [] as string[] });
  void setItems;
  void setProfile;

  const onAdd = (next: string) => {
    items.push(next);
    items[0] = next;
    profile.tags.push(next);
    items.splice(0, 1);
    items.sort();
    items.reverse();
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    // 6 mutations on \`items\` + 1 on \`profile.tags\`.
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.some((hit) => hit.message.includes('"items"'))).toBe(true);
    expect(hits.some((hit) => hit.message.includes('"profile"'))).toBe(true);
  });

  it("does not flag immutable counterparts (toSorted/toReversed/toSpliced)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-immutable", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const onSort = () => setItems(items.toSorted());
  const onReverse = () => setItems(items.toReversed());
  const onSplice = () => setItems(items.toSpliced(0, 1));
  void onSort;
  void onReverse;
  void onSplice;
  return <span>{items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a local variable that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const buildLocal = (raw: string) => {
    const items = raw.split(",");
    items.push("extra");
    return items;
  };

  return <span>{buildLocal("a,b").length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a parameter that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-param-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const helper = (items: string[]) => {
    items.push("local");
    return items;
  };

  return <span>{helper(["a"]).length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });
});

describe("no-set-state-in-render", () => {
  it("flags an unconditional top-level setter call", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-pos", {
      files: {
        "src/Greeting.tsx": `import { useState } from "react";

export const Greeting = () => {
  const [name, setName] = useState("");
  setName("Alice");
  return <h1>{name}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("setName");
  });

  it("does not flag the canonical conditional 'derive state from props' pattern", async () => {
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-conditional", {
      files: {
        "src/CountLabel.tsx": `import { useState } from "react";

export const CountLabel = ({ count }: { count: number }) => {
  const [prevCount, setPrevCount] = useState(count);
  const [trend, setTrend] = useState<string | null>(null);
  if (prevCount !== count) {
    setPrevCount(count);
    setTrend(count > prevCount ? "up" : "down");
  }
  return <h1>{trend}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside an event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-handler", {
      files: {
        "src/Counter.tsx": `import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside useEffect", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-effect", {
      files: {
        "src/Loader.tsx": `import { useEffect, useState } from "react";

export const Loader = () => {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData("loaded");
  }, []);
  return <div>{data}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });
});

describe("no-effect-event-handler (widened to MemberExpression test root)", () => {
  it("flags the article §5 `if (product.isInCart)` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-member-expression", {
      files: {
        "src/ProductPage.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

interface Product { isInCart: boolean; name: string }

export const ProductPage = ({ product }: { product: Product }) => {
  useEffect(() => {
    if (product.isInCart) {
      showNotification(\`Added \${product.name} to the shopping cart!\`);
    }
  }, [product]);

  return <div>{product.name}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("simulating an event handler");
  });

  it("still flags the bare-Identifier shape", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-identifier", {
      files: {
        "src/Modal.tsx": `import { useEffect } from "react";

export const Modal = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add("modal-open");
    }
  }, [isOpen]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag when the test's root identifier is not in the deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-event-handler-unrelated-test", {
      files: {
        "src/Page.tsx": `import { useEffect } from "react";

declare const sideEffect: () => void;

export const Page = ({ unrelated }: { unrelated: boolean }) => {
  useEffect(() => {
    if (window.matchMedia("(max-width: 600px)").matches) {
      sideEffect();
    }
  }, [unrelated]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(hits).toHaveLength(0);
  });
});

describe("no-derived-state-effect (memo-message branch)", () => {
  it("flags an expensive derivation with a useMemo recommendation", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#caching-expensive-calculations
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-memo", {
      files: {
        "src/TodoList.tsx": `import { useEffect, useState } from "react";

declare const getFilteredTodos: (todos: string[], filter: string) => string[];

export const TodoList = ({ todos, filter }: { todos: string[]; filter: string }) => {
  const [visibleTodos, setVisibleTodos] = useState<string[]>([]);
  useEffect(() => {
    setVisibleTodos(getFilteredTodos(todos, filter));
  }, [todos, filter]);

  return <div>{visibleTodos.length}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useMemo");
  });

  it("keeps the 'compute during render' message for trivial derivations", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-trivial", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return <div>{fullName}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("still uses the 'state reset' message when no dep is referenced", async () => {
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-reset", {
      files: {
        "src/ProfilePage.tsx": `import { useEffect, useState } from "react";

export const ProfilePage = ({ userId }: { userId: string }) => {
  const [comment, setComment] = useState("");
  useEffect(() => {
    setComment("");
  }, [userId]);
  return <textarea value={comment} onChange={(event) => setComment(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("key prop");
  });

  it("treats coercion helpers (Number, parseInt) as trivial", async () => {
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-coercion", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ raw }: { raw: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(Number(raw));
  }, [raw]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("flags `Math.floor(raw)` and treats it as a trivial derivation (Bugbot #153 round 2)", async () => {
    // Regression: \`Math.floor(raw)\` previously bailed the rule
    // entirely — \`collectValueIdentifierNames\` collected "Math" as
    // a reactive read, "Math" wasn't in deps, allArgumentsDeriveFromDeps
    // went false, no diagnostic. The chain root is now skipped when
    // it's a built-in global namespace, and the call is trivial.
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-math-floor", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ raw }: { raw: number }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(Math.floor(raw));
  }, [raw]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("flags `setX(applyFilters())` as expensive, not as a state reset (Bugbot #153 round 2)", async () => {
    // Regression: zero-arg call \`applyFilters()\` produced an empty
    // identifier list, both .some() checks vacuously passed, and the
    // rule fired with the wrong "state reset" message. Now the
    // callee identifier is collected so the dep mismatch correctly
    // bails or — in this case — is recognized as expensive (because
    // \`applyFilters\` isn't in TRIVIAL_DERIVATION_CALLEE_NAMES) AND
    // referenced via deps (\`filter\`).
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-zero-arg-call", {
      files: {
        "src/TodoList.tsx": `import { useEffect, useState } from "react";

declare const applyFilters: (todos: string[]) => string[];

export const TodoList = ({ todos, filter }: { todos: string[]; filter: string }) => {
  const [visible, setVisible] = useState<string[]>([]);
  useEffect(() => {
    setVisible(applyFilters(todos));
  }, [todos, filter]);
  return <div>{visible.length}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).not.toContain("key prop");
    expect(hits[0].message).toContain("useMemo");
  });
});

describe("no-uncontrolled-input", () => {
  it("flags `value` without onChange / readOnly", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-no-onchange", {
      files: {
        "src/Form.tsx": `export const Form = () => <input value="frozen" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("silently read-only");
  });

  it("flags `value` + `defaultValue` set together", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-both", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState("");
  return (
    <input
      value={name}
      defaultValue="hello"
      onChange={(event) => setName(event.target.value)}
    />
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("defaultValue");
  });

  it("flags useState() with no initial value used as `value`", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-flip", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = () => {
  const [name, setName] = useState();
  return <input value={name} onChange={(event) => setName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("uncontrolled");
  });

  it("does not flag <input type='checkbox' value='cat'> (value is a form token)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-checkbox", {
      files: {
        "src/Form.tsx": `export const Form = () => <input type="checkbox" value="cat" />;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });

  it("does not flag inputs with spread props (onChange may come from spread)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-uncontrolled-input-spread", {
      files: {
        "src/Form.tsx": `import { useState } from "react";

export const Form = ({ inputProps }: { inputProps: object }) => {
  const [name, setName] = useState("");
  void setName;
  return (
    <>
      <input value={name} {...inputProps} />
      <input {...inputProps} value={name} />
    </>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-uncontrolled-input");
    expect(hits).toHaveLength(0);
  });
});

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

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", 19);
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

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", 18);
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

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", 17);
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

  it("fires when reactMajorVersion is unknown (null) so we never silently swallow real findings", async () => {
    // Matches the existing convention — null version detection keeps every
    // rule enabled. See `filterRulesByReactMajor` in oxlint-config.ts.
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

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event", null);
    expect(hits).toHaveLength(1);
  });
});
