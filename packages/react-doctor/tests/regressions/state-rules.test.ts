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
