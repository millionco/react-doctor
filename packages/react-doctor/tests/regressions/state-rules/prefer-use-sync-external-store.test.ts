import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("prefer-use-sync-external-store");

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

  it("DOES flag a useSyncExternalStore reimplementation whose cleanup uses a generic teardown verb (`cleanup()`)", async () => {
    // Regression: `cleanupReleasesSubscription` previously only accepted
    // `UNSUBSCRIPTION_METHOD_NAMES` plus the literal bound-unsubscribe
    // name. Generic teardown verbs from `CLEANUP_LIKE_RELEASE_CALLEE_NAMES`
    // (`cleanup`, `dispose`, `destroy`, `teardown`) were silently ignored,
    // so a complete useSyncExternalStore reimplementation with a
    // generic-named cleanup slipped past detection — even though
    // `effectNeedsCleanup` (which already shared the broader allowlist)
    // recognized the same shape. Both rules now share the same
    // `isReleaseLikeCall` primitive.
    const projectDir = setupReactProject(tempRoot, "prefer-use-sync-external-store-cleanup-verb", {
      files: {
        "src/Cleaned.tsx": `import { useEffect, useState } from "react";

declare const store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
};
declare const cleanup: () => void;

export const Cleaned = () => {
  const [snapshot, setSnapshot] = useState(store.getSnapshot());
  useEffect(() => {
    store.subscribe(() => {
      setSnapshot(store.getSnapshot());
    });
    return () => cleanup();
  }, []);
  return <div>{snapshot}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-sync-external-store");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useSyncExternalStore");
  });
});
