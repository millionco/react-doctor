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

describe("no-event-trigger-state", () => {
  it("flags the article §6 `if (jsonToSubmit !== null) post(...)` POST-trigger shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#sending-a-post-request
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-post", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

declare const post: (url: string, body: unknown) => void;

export const Form = () => {
  const [firstName, setFirstName] = useState("");
  const [jsonToSubmit, setJsonToSubmit] = useState<{ firstName: string } | null>(null);
  useEffect(() => {
    if (jsonToSubmit !== null) {
      post("/api/register", jsonToSubmit);
    }
  }, [jsonToSubmit]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setJsonToSubmit({ firstName });
      }}
    >
      <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
    </form>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("jsonToSubmit");
    expect(hits[0].message).toContain("post");
  });

  it("flags `axios.post` member call inside the trigger guard", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-axios", {
      files: {
        "src/Submit.tsx": `import { useEffect, useState } from "react";

declare const axios: { post: (url: string, body: unknown) => void };

export const Submit = () => {
  const [pendingPayload, setPendingPayload] = useState<{ id: number } | null>(null);
  useEffect(() => {
    if (pendingPayload !== null) {
      axios.post("/api/submit", pendingPayload);
    }
  }, [pendingPayload]);
  return <button onClick={() => setPendingPayload({ id: 1 })}>Submit</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("axios.post");
  });

  it("flags the bare-truthy guard with `navigate(...)` in the body", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-navigate", {
      files: {
        "src/Wizard.tsx": `import { useEffect, useState } from "react";

declare const navigate: (path: string) => void;

export const Wizard = () => {
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (destination) {
      navigate(destination);
    }
  }, [destination]);
  return <button onClick={() => setDestination("/next")}>Next</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("navigate");
  });

  it("does NOT flag the article's GOOD analytics-on-mount example", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#sending-a-post-request
    // The mount-time analytics POST is a legitimate effect — empty deps,
    // no trigger state, runs once because the form was displayed.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-analytics", {
      files: {
        "src/AnalyticsForm.tsx": `import { useEffect, useState } from "react";

declare const post: (url: string, body: unknown) => void;

export const AnalyticsForm = () => {
  const [firstName, setFirstName] = useState("");
  useEffect(() => {
    post("/analytics/event", { eventName: "visit_form" });
  }, []);
  return <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the trigger state is also written outside event handlers", async () => {
    // If the state is also set by other reactive logic (another effect,
    // top-of-render adjustment), it's not "purely a trigger" — the user
    // may have legitimate reasons to re-react when it changes.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-non-handler-write", {
      files: {
        "src/Mixed.tsx": `import { useEffect, useState } from "react";

declare const post: (url: string, body: unknown) => void;

export const Mixed = ({ initial }: { initial: { id: number } | null }) => {
  const [payload, setPayload] = useState<{ id: number } | null>(null);
  useEffect(() => {
    setPayload(initial);
  }, [initial]);
  useEffect(() => {
    if (payload !== null) {
      post("/api/sync", payload);
    }
  }, [payload]);
  return <button onClick={() => setPayload({ id: 99 })}>Override</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the consequent has no recognized side-effect", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-no-side-effect", {
      files: {
        "src/Computed.tsx": `import { useEffect, useState } from "react";

declare const compute: (value: number) => number;

export const Computed = () => {
  const [seed, setSeed] = useState<number | null>(null);
  useEffect(() => {
    if (seed !== null) {
      compute(seed);
    }
  }, [seed]);
  return <button onClick={() => setSeed(7)}>Set</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(0);
  });

  it("flags `undefined !== state` (reversed sentinel ordering, Bugbot #155 round 2)", async () => {
    // Regression: \`undefined\` is parsed as Identifier, not Literal.
    // Naive "first Identifier wins" picked \`"undefined"\` for
    // reversed-ordering BinaryExpressions and silently dropped the
    // violation. Prefer the non-sentinel side.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-reversed-undefined", {
      files: {
        "src/Submit.tsx": `import { useEffect, useState } from "react";

declare const post: (url: string, body: unknown) => void;

export const Submit = () => {
  const [pendingPayload, setPendingPayload] = useState<{ id: number } | null>(null);
  useEffect(() => {
    if (undefined !== pendingPayload) {
      post("/api/submit", pendingPayload);
    }
  }, [pendingPayload]);
  return <button onClick={() => setPendingPayload({ id: 1 })}>Submit</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT misclassify Array.prototype.push as an event-triggered side effect", async () => {
    // Regression: \`push\` is BOTH a router method (router.push("/foo"))
    // AND a built-in Array method ([1,2].push(3)). The receiver gates
    // the diagnostic — only router-shaped receivers count.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-array-push", {
      files: {
        "src/Logger.tsx": `import { useEffect, useState } from "react";

const auditLog: string[] = [];

export const Logger = () => {
  const [event, setEvent] = useState<string | null>(null);
  useEffect(() => {
    if (event) {
      auditLog.push(event);
    }
  }, [event]);
  return <button onClick={() => setEvent("clicked")}>Click</button>;
};
`,
      },
    });

    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(triggerHits.length).toBe(0);
  });

  it("DOES still flag router.push as an event-triggered side effect", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-router-push", {
      files: {
        "src/Wizard.tsx": `import { useEffect, useState } from "react";

declare const router: { push: (path: string) => void };

export const Wizard = () => {
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (destination) {
      router.push(destination);
    }
  }, [destination]);
  return <button onClick={() => setDestination("/next")}>Next</button>;
};
`,
      },
    });

    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(triggerHits.length).toBe(1);
  });

  it("KEEPS no-effect-event-handler warning when state-typed dep has a non-allowlisted callee (Bugbot #155 round 3)", async () => {
    // Regression: round-2 deference was too eager — it skipped
    // no-effect-event-handler whenever the trigger was a useState
    // value, but no-event-trigger-state has a tighter side-effect-
    // callee allowlist. \`customAction()\` isn't in the allowlist, so
    // no-event-trigger-state would NOT fire — and the round-2
    // version then silently dropped the warning. Now no-effect-
    // event-handler fires unless BOTH predicates match.
    const projectDir = setupReactProject(
      tempRoot,
      "no-event-trigger-state-no-overshadow-on-custom-callee",
      {
        files: {
          "src/Custom.tsx": `import { useEffect, useState } from "react";

declare const customAction: () => void;

export const Custom = () => {
  const [trigger, setTrigger] = useState(false);
  useEffect(() => {
    if (trigger) {
      customAction();
    }
  }, [trigger]);
  return <button onClick={() => setTrigger(true)}>Go</button>;
};
`,
        },
      },
    );

    const handlerHits = await collectRuleHits(projectDir, "no-effect-event-handler");
    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    // customAction isn't in the side-effect allowlist → no-event-
    // trigger-state stays silent. no-effect-event-handler MUST still
    // warn (otherwise we silently dropped the diagnostic).
    expect(handlerHits.length).toBe(1);
    expect(triggerHits.length).toBe(0);
  });

  it("intentionally double-warns on the bare-truthy state shape (handler + trigger-state both fire)", async () => {
    // Regression: \`if (destination) navigate(destination)\` triggers
    // BOTH no-effect-event-handler and no-event-trigger-state. An
    // earlier implementation tried to defer the former to the latter,
    // but that deference silently dropped diagnostics whenever the
    // narrower rule's preconditions (handler-only writes,
    // not render-reachable, etc.) didn't hold. Both rules now fire
    // independently — the messages frame the same code differently
    // ("this useEffect simulates a handler" vs "this state exists
    // only to schedule navigate from an effect") so a duplicate is
    // strictly better than a silent drop.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-double-warn", {
      files: {
        "src/Wizard.tsx": `import { useEffect, useState } from "react";

declare const navigate: (path: string) => void;

export const Wizard = () => {
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => {
    if (destination) {
      navigate(destination);
    }
  }, [destination]);
  return <button onClick={() => setDestination("/next")}>Next</button>;
};
`,
      },
    });

    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    const handlerHits = await collectRuleHits(projectDir, "no-effect-event-handler");
    expect(triggerHits.length).toBe(1);
    expect(handlerHits.length).toBe(1);
  });

  it("does NOT flag dual-purpose state that's also read in render (Bugbot #155)", async () => {
    // Regression: \`query\` is BOTH the controlled-input value AND the
    // effect trigger. We can't tell the user to "delete the state"
    // because the input depends on it. Render-reachability check
    // skips this case.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-render-reachable", {
      files: {
        "src/Search.tsx": `import { useEffect, useState } from "react";

declare const track: (eventName: string, payload: string) => void;

export const Search = () => {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (query) {
      track("search", query);
    }
  }, [query]);
  return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the dep is a prop (no local setter at all)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-prop-dep", {
      files: {
        "src/Notify.tsx": `import { useEffect } from "react";

declare const showNotification: (message: string) => void;

export const Notify = ({ message }: { message: string | null }) => {
  useEffect(() => {
    if (message !== null) {
      showNotification(message);
    }
  }, [message]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(hits).toHaveLength(0);
  });
});

describe("no-effect-chain", () => {
  it("flags the article §7 Game-style cross-effect chain", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#chains-of-computations
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-game", {
      files: {
        "src/Game.tsx": `import { useEffect, useState } from "react";

interface Card { gold: boolean }

export const Game = ({ card }: { card: Card | null }) => {
  const [goldCount, setGoldCount] = useState(0);
  const [round, setRound] = useState(1);
  const [isGameOver, setIsGameOver] = useState(false);

  useEffect(() => {
    if (card !== null && card.gold) {
      setGoldCount((c) => c + 1);
    }
  }, [card]);

  useEffect(() => {
    if (goldCount > 3) {
      setRound((r) => r + 1);
      setGoldCount(0);
    }
  }, [goldCount]);

  useEffect(() => {
    if (round > 5) {
      setIsGameOver(true);
    }
  }, [round]);

  return <div>{isGameOver ? "over" : round}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((hit) => hit.message.includes("goldCount"))).toBe(true);
    expect(hits.some((hit) => hit.message.includes("round"))).toBe(true);
  });

  it("does NOT flag a single effect with multiple setters (covered by no-cascading-set-state)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-single-effect", {
      files: {
        "src/Settings.tsx": `import { useEffect, useState } from "react";

export const Settings = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => {
    setName("default");
    setEmail("default@example.com");
  }, []);
  return <div>{name} {email}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag the article's GOOD network-cascade exception with a real write→dep chain", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-network-real-chain", {
      files: {
        "src/ShippingForm.tsx": `import { useEffect, useState } from "react";

export const ShippingForm = ({ country }: { country: string }) => {
  const [cities, setCities] = useState<string[] | null>(null);
  const [areas, setAreas] = useState<string[] | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch(\`/api/cities?country=\${country}\`)
      .then((response) => response.json())
      .then((json) => {
        if (!ignore) setCities(json);
      });
    return () => {
      ignore = true;
    };
  }, [country]);

  useEffect(() => {
    if (cities === null) return;
    let ignore = false;
    fetch(\`/api/areas?cities=\${cities.join(",")}\`)
      .then((response) => response.json())
      .then((json) => {
        if (!ignore) setAreas(json);
      });
    return () => {
      ignore = true;
    };
  }, [cities]);

  return <span>{areas?.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a chat-connection chain when both effects do real external sync", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-chat-real-chain", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const createConnection: (url: string) => {
  connect: () => Promise<string>;
  disconnect: () => void;
};
declare const window: { addEventListener: (name: string, handler: () => void) => void; removeEventListener: (name: string, handler: () => void) => void };

export const Chat = ({ roomId }: { roomId: string }) => {
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const connection = createConnection(roomId);
    connection.connect().then(setStatus);
    return () => connection.disconnect();
  }, [roomId]);

  useEffect(() => {
    const onFocus = () => setStatus("connecting");
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status]);

  return <span>{status}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("DOES still flag chains where effects only call `set.delete()` (Bugbot #156 round 3)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-set-delete-not-external", {
      files: {
        "src/Pruner.tsx": `import { useEffect, useState } from "react";

export const Pruner = ({ stale }: { stale: ReadonlySet<string> }) => {
  const [pruned, setPruned] = useState<Set<string>>(new Set());
  const [count, setCount] = useState(0);
  useEffect(() => {
    const next = new Set<string>();
    for (const item of stale) next.add(item);
    next.delete("ignore-me");
    setPruned(next);
  }, [stale]);
  useEffect(() => {
    setCount(pruned.size);
  }, [pruned]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("DOES still flag chains where effects only call `params.get()` (Bugbot #156 round 2)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-params-get-not-external", {
      files: {
        "src/Settings.tsx": `import { useEffect, useState } from "react";

declare const params: URLSearchParams;

export const Settings = () => {
  const [theme, setTheme] = useState("");
  const [highlight, setHighlight] = useState("");
  useEffect(() => {
    setTheme(params.get("theme") ?? "light");
  }, []);
  useEffect(() => {
    setHighlight(theme === "dark" ? "white" : "black");
  }, [theme]);
  return <span style={{ color: highlight }}>{theme}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag a real write→dep cascade where both effects use `axios.get` (Bugbot #156, real chain)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-axios-real-cascade", {
      files: {
        "src/Cascade.tsx": `import { useEffect, useState } from "react";

declare const axios: { get: (url: string) => Promise<{ data: unknown }> };

export const Cascade = ({ country }: { country: string }) => {
  const [cities, setCities] = useState<Array<string> | null>(null);
  const [enriched, setEnriched] = useState<Array<string> | null>(null);

  useEffect(() => {
    let ignore = false;
    axios.get(\`/api/cities?country=\${country}\`).then((response) => {
      if (!ignore) setCities(response.data as Array<string>);
    });
    return () => {
      ignore = true;
    };
  }, [country]);

  useEffect(() => {
    if (cities === null) return;
    let ignore = false;
    axios.get("/api/enrich").then((response) => {
      if (!ignore) setEnriched(response.data as Array<string>);
    });
    return () => {
      ignore = true;
    };
  }, [cities]);

  return <span>{enriched?.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag two effects whose written/read state sets are disjoint", async () => {
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-disjoint", {
      files: {
        "src/Profile.tsx": `import { useEffect, useState } from "react";

export const Profile = ({ userId, theme }: { userId: string; theme: string }) => {
  const [name, setName] = useState("");
  const [highlight, setHighlight] = useState("");
  useEffect(() => {
    setName(userId.toUpperCase());
  }, [userId]);
  useEffect(() => {
    setHighlight(theme === "dark" ? "white" : "black");
  }, [theme]);
  return <span style={{ color: highlight }}>{name}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
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
describe("effect-needs-cleanup", () => {
  it("flags a useEffect with addEventListener but no cleanup", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-listener", {
      files: {
        "src/Resize.tsx": `import { useEffect, useState } from "react";

export const Resize = () => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    window.addEventListener("resize", () => setWidth(window.innerWidth));
  }, []);
  return <span>{width}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("addEventListener");
  });

  it("flags a useEffect with setInterval but no cleanup", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-interval", {
      files: {
        "src/Clock.tsx": `import { useEffect, useState } from "react";

export const Clock = () => {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setInterval(() => setNow(Date.now()), 1000);
  }, []);
  return <span>{now}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("setInterval");
  });

  it("flags a useEffect with `store.subscribe` but no return", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-subscribe", {
      files: {
        "src/Audit.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const audit: () => void;

export const Audit = () => {
  useEffect(() => {
    store.subscribe(() => audit());
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag a useEffect that returns the unsubscribe binding", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-bare-return", {
      files: {
        "src/Stable.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const audit: () => void;

export const Stable = () => {
  useEffect(() => {
    const unsubscribe = store.subscribe(() => audit());
    return unsubscribe;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a useEffect that returns a cleanup arrow calling removeEventListener", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-remove-listener", {
      files: {
        "src/Resize.tsx": `import { useEffect, useState } from "react";

export const Resize = () => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return <span>{width}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a useEffect that returns a cleanup arrow calling clearInterval", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-clear-interval", {
      files: {
        "src/Clock.tsx": `import { useEffect, useState } from "react";

export const Clock = () => {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span>{now}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag expression-body arrow whose subscribe return is the implicit cleanup (Bugbot #157)", async () => {
    // Regression: \`useEffect(() => store.subscribe(handler), [])\` is a
    // common compact form — the arrow's expression body IS the body,
    // and the subscribe call's return value (the unsubscribe fn) is
    // implicitly returned as the effect's cleanup. The earlier
    // detector rejected non-BlockStatement bodies outright and
    // false-positived this shape.
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-expression-body", {
      files: {
        "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => store.subscribe(handler), []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a `setTimeout` that lives inside the cleanup return (Bugbot #157 round 3)", async () => {
    // Regression: the subscribe/timer scanner walked the entire
    // callback including the cleanup return body. A \`setTimeout\` in
    // the cleanup is a disposal step, not a new registration; it
    // should not produce a 'missing cleanup' diagnostic.
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-timer-in-cleanup", {
      files: {
        "src/Beacon.tsx": `import { useEffect } from "react";

declare const doSetup: () => void;
declare const sendBeacon: () => void;

export const Beacon = () => {
  useEffect(() => {
    doSetup();
    return () => {
      setTimeout(() => sendBeacon(), 0);
    };
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `return () => unsub()` after `const unsub = subscribe(...)` (Bugbot #157 round 3)", async () => {
    // Regression: the Identifier-callee cleanup regex only matched
    // long-form names (unsubscribe / cleanup / dispose / destroy /
    // teardown). \`unsub\` (and other short forms) were missing,
    // producing a false positive on the canonical bind-the-result-
    // and-call-it shape.
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-short-unsub-call", {
      files: {
        "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    const unsub = store.subscribe(handler);
    return () => unsub();
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a BlockStatement that explicitly returns a subscribe call (Bugbot #157, sibling form)", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-return-subscribe", {
      files: {
        "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    return store.subscribe(handler);
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });
});

describe("no-mirror-prop-effect", () => {
  it("flags the canonical `useState(prop) + useEffect(setX(prop), [prop])` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-canonical", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("draft");
    expect(hits[0].message).toContain("value");
  });

  it("flags the MemberExpression variant `useState(prop.x) + setDraft(prop.x)`", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-member", {
      files: {
        "src/Profile.tsx": `import { useEffect, useState } from "react";

interface User { name: string }

export const Profile = ({ user }: { user: User }) => {
  const [draftName, setDraftName] = useState(user.name);
  useEffect(() => {
    setDraftName(user.name);
  }, [user]);
  return <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("draftName");
    expect(hits[0].message).toContain("user");
  });

  it("does NOT flag a `useState(prop)` without a paired mirror effect (uncontrolled-with-key shape)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-uncontrolled", {
      files: {
        "src/Field.tsx": `import { useState } from "react";

export const Field = ({ initialValue }: { initialValue: string }) => {
  const [value, setValue] = useState(initialValue);
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `useEffect(() => setX(value), [value])` without a paired `useState(value)` mirror", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-no-paired", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ value }: { value: string }) => {
  const [doubled, setDoubled] = useState("");
  useEffect(() => {
    setDoubled(value + value);
  }, [value]);
  return <span>{doubled}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the useState initializer doesn't match the setter argument", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-mismatch", {
      files: {
        "src/Mismatch.tsx": `import { useEffect, useState } from "react";

export const Mismatch = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);
  return <span>{draft}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a useEffect inside a nested helper that closes over an outer prop", async () => {
    // The inner helper isn't a component; its mirror-shape useState +
    // useEffect uses `value` from Outer's closure, not its own props.
    // The outer prop set must NOT leak into Inner's lookup.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ value }: { value: string }) => {
  function inner() {
    const [draft, setDraft] = useState(value);
    useEffect(() => {
      setDraft(value);
    }, [value]);
    void draft;
    void setDraft;
  }
  inner();
  return <span>{value}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });
});

describe("no-mutable-in-deps", () => {
  it("flags `location.pathname` in a useEffect deps array", async () => {
    // https://react.dev/learn/lifecycle-of-reactive-effects#can-global-or-mutable-values-be-dependencies
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-location", {
      files: {
        "src/Page.tsx": `import { useEffect } from "react";

declare const trackPageView: (path: string) => void;

export const Page = () => {
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("location.*");
  });

  it("flags `<refIdent>.current` from a useRef binding in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-ref-current", {
      files: {
        "src/Spy.tsx": `import { useEffect, useRef } from "react";

declare const observeNode: (element: HTMLDivElement | null) => void;

export const Spy = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    observeNode(containerRef.current);
  }, [containerRef.current]);
  return <div ref={containerRef} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("containerRef.current");
  });

  it("flags `window.innerWidth` (deeper mutable global access) in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-window", {
      files: {
        "src/Layout.tsx": `import { useEffect, useState } from "react";

export const Layout = () => {
  const [, setSize] = useState(0);
  useEffect(() => {
    setSize(window.innerWidth);
  }, [window.innerWidth]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag a bare ref Identifier (the ref object itself is stable)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-bare-ref", {
      files: {
        "src/Stable.tsx": `import { useEffect, useRef } from "react";

declare const setupObserver: (target: { current: HTMLDivElement | null }) => () => void;

export const Stable = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return setupObserver(containerRef);
  }, [containerRef]);
  return <div ref={containerRef} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a regular state.field MemberExpression (state IS reactive)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-state-field", {
      files: {
        "src/Settings.tsx": `import { useEffect, useState } from "react";

export const Settings = () => {
  const [profile] = useState({ name: "ada" });
  useEffect(() => {
    document.title = profile.name;
  }, [profile.name]);
  return <span>{profile.name}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(0);
  });
});

describe("rerender-functional-setstate (extended to spread)", () => {
  it("flags `setMessages([...messages, item])` array-spread shape", async () => {
    // https://react.dev/learn/removing-effect-dependencies#are-you-reading-some-state-to-calculate-the-next-state
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-array-spread", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const subscribe: (handler: (message: string) => void) => () => void;

export const Chat = () => {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return subscribe((received) => {
      setMessages([...messages, received]);
    });
  }, [messages]);
  return <ul>{messages.map((line) => <li key={line}>{line}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("[...messages");
    expect(hits[0].message).toContain("functional update");
  });

  it("flags `setProfile({ ...profile, name })` object-spread shape", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-object-spread", {
      files: {
        "src/Profile.tsx": `import { useState } from "react";

export const Profile = () => {
  const [profile, setProfile] = useState({ name: "", email: "" });
  const onChangeName = (event: { target: { value: string } }) => {
    setProfile({ ...profile, name: event.target.value });
  };
  return (
    <input
      value={profile.name}
      onChange={onChangeName}
    />
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("...profile");
  });

  it("does NOT flag `setMessages(msgs => [...msgs, item])` (the recommended fix)", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-good", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const subscribe: (handler: (message: string) => void) => () => void;

export const Chat = () => {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return subscribe((received) => {
      setMessages((msgs) => [...msgs, received]);
    });
  }, []);
  return <ul>{messages.map((line) => <li key={line}>{line}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `setItems([...other, x])` where the spread source is unrelated", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-unrelated", {
      files: {
        "src/Merge.tsx": `import { useState } from "react";

export const Merge = ({ baseline }: { baseline: string[] }) => {
  const [items, setItems] = useState<string[]>([]);
  const onReset = () => setItems([...baseline, "first"]);
  return <button onClick={onReset}>{items.length}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits).toHaveLength(0);
  });
});

describe("rerender-dependencies (extended to inline functions)", () => {
  it("flags an ArrowFunctionExpression in a useEffect deps array", async () => {
    // https://react.dev/learn/removing-effect-dependencies#does-some-reactive-value-change-unintentionally
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-arrow", {
      files: {
        "src/Sync.tsx": `import { useEffect } from "react";

declare const subscribe: (handler: () => void) => () => void;

export const Sync = () => {
  useEffect(() => {
    const unsubscribe = subscribe(() => {});
    return unsubscribe;
  }, [() => "fresh-each-render"]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((hit) => hit.message.includes("Inline function"))).toBe(true);
  });

  it("flags a FunctionExpression in a useCallback deps array", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-fn-expr", {
      files: {
        "src/Memo.tsx": `import { useCallback } from "react";

export const Memo = () => {
  const callback = useCallback(
    () => {},
    [function unstable() {}],
  );
  return <button onClick={callback}>x</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT flag a stable function reference (Identifier) in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-dependencies-identifier", {
      files: {
        "src/Stable.tsx": `import { useCallback, useEffect, useMemo } from "react";

export const Stable = ({ onChange }: { onChange: () => void }) => {
  const memoized = useMemo(() => 1, [onChange]);
  const callback = useCallback(() => memoized, [memoized, onChange]);
  useEffect(() => {
    callback();
  }, [callback]);
  return <span>{memoized}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-dependencies");
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
