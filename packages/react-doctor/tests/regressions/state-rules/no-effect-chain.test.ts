import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-effect-chain");

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

  it("does NOT flag a chain whose writer setter runs inside a deferred sub-handler (setTimeout)", async () => {
    // Regression: `collectWrittenStateNamesInEffect` previously walked
    // the ENTIRE callback (including nested function bodies). A `setX`
    // inside `setTimeout(() => setX(...))` was attributed as a sync
    // chain write, producing a noisy diagnostic on the dominant
    // debounce / delayed-fetch pattern.
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-deferred-write", {
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ raw }: { raw: string }) => {
  const [debounced, setDebounced] = useState("");
  const [upper, setUpper] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(raw), 300);
    return () => clearTimeout(id);
  }, [raw]);
  useEffect(() => {
    setUpper(debounced.toUpperCase());
  }, [debounced]);
  return <span>{upper}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(0);
  });

  it("DOES flag a chain when the writer effect uses a non-function `return` (literal / state read)", async () => {
    // Regression: previously ANY `return <argument>` made the writer
    // effect look "external sync" — so `return null` or `return foo`
    // silently disabled chain detection. We now require the returned
    // value to be function-shaped for the early-out.
    const projectDir = setupReactProject(tempRoot, "no-effect-chain-return-literal", {
      files: {
        "src/Chain.tsx": `import { useEffect, useState } from "react";

export const Chain = ({ userId }: { userId: string }) => {
  const [name, setName] = useState("");
  const [upper, setUpper] = useState("");
  useEffect(() => {
    setName(userId);
    return null;
  }, [userId]);
  useEffect(() => {
    setUpper(name.toUpperCase());
  }, [name]);
  return <span>{upper}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-effect-chain");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("name");
  });
});
