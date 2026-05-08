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
): Promise<Array<{ filePath: string; message: string }>> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    hasTypeScript: true,
    framework: "unknown",
    hasReactCompiler: false,
    hasTanStackQuery: false,
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

describe("prefer-use-sync-external-store", () => {
  it("flags the canonical `useState(getSnapshot()) + useEffect(() => store.subscribe(handler))` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#subscribing-to-an-external-store
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-canonical", {
      files: {
        "src/Snapshot.tsx": `import { useEffect, useState } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
};

export const Snapshot = () => {
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setSnapshot(store.getSnapshot());
    });
    return unsubscribe;
  }, []);
  return <div>{snapshot}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useSyncExternalStore");
    expect(hits[0].message).toContain("snapshot");
  });

  it("flags the browser-API `addEventListener` shape (matchMedia / navigator.onLine)", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-online", {
      files: {
        "src/Online.tsx": `import { useEffect, useState } from "react";

export const Online = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const onChange = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", onChange);
    return () => {
      window.removeEventListener("online", onChange);
    };
  }, []);
  return <span>{isOnline ? "online" : "offline"}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(1);
  });

  it("flags the lazy-initializer variant `useState(() => getSnapshot())`", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-lazy", {
      files: {
        "src/Lazy.tsx": `import { useEffect, useState } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string;
};

export const Lazy = () => {
  const [value, setValue] = useState(() => store.getSnapshot());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setValue(store.getSnapshot());
    });
    return unsubscribe;
  }, []);
  return <div>{value}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag a legitimate chat-connection effect with non-empty deps", async () => {
    // From the article's "Choosing between event handlers and Effects" — this is
    // the canonical correct external-system sync. Non-empty deps disqualify the
    // useSyncExternalStore detector.
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-chat", {
      files: {
        "src/Chat.tsx": `import { useEffect } from "react";

declare const createConnection: (serverUrl: string, roomId: string) => {
  connect: () => void;
  disconnect: () => void;
};

export const Chat = ({ roomId }: { roomId: string }) => {
  useEffect(() => {
    const connection = createConnection("https://localhost:1234", roomId);
    connection.connect();
    return () => connection.disconnect();
  }, [roomId]);
  return <h1>{roomId}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a subscription without paired useState (subscribe-as-side-effect)", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-no-state", {
      files: {
        "src/Audit.tsx": `import { useEffect } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
};
declare const auditStateChange: () => void;

export const Audit = () => {
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      auditStateChange();
    });
    return unsubscribe;
  }, []);
  return <span>auditing</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the useState initializer is unrelated to the subscribe getter", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-mismatched", {
      files: {
        "src/Mismatch.tsx": `import { useEffect, useState } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
  computeSomethingElse: () => number;
};

export const Mismatch = () => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setValue(store.computeSomethingElse());
    });
    return unsubscribe;
  }, []);
  return <span>{value}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the effect has no cleanup", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-no-cleanup", {
      files: {
        "src/Leaky.tsx": `import { useEffect, useState } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
};

export const Leaky = () => {
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  useEffect(() => {
    store.subscribe(() => {
      setSnapshot(store.getSnapshot());
    });
  }, []);
  return <div>{snapshot}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(0);
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
