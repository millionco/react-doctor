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
