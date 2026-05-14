import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("effect-needs-cleanup");

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

  it("recognizes the generic teardown vocabulary (`cleanup`, `dispose`, `destroy`, `teardown`) as a release call", async () => {
    // The release-callee allowlist now lives in `constants.ts` as
    // `CLEANUP_LIKE_RELEASE_CALLEE_NAMES`. Each of the generic
    // teardown verbs satisfies the cleanup check on its own — no
    // false positive on this shape.
    for (const releaseName of ["cleanup", "dispose", "destroy", "teardown"]) {
      const projectDir = setupReactProject(
        tempRoot,
        `effect-needs-cleanup-generic-teardown-${releaseName}`,
        {
          files: {
            "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => { ${releaseName}: () => void } };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    const handle = store.subscribe(handler);
    const ${releaseName} = () => handle.${releaseName}();
    return () => ${releaseName}();
  }, []);
  return <span />;
};
`,
          },
        },
      );

      const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
      expect(hits).toHaveLength(0);
    }
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

  // HACK: regression for the ~36% FP rate measured against
  // react-grab/excalidraw/etc. The previous detector only inspected the
  // top-level last statement; cleanup nested inside an `if` block was
  // invisible. Real-world shape: gated subscription + early-return.
  it("does NOT flag cleanup nested inside an `if` block (early-return guard pattern)", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-conditional-cleanup", {
      files: {
        "src/Popover.tsx": `import { useEffect } from "react";

export const Popover = ({ isOpen }: { isOpen: boolean }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = () => {};
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag cleanup that is the last statement *inside* a conditional branch", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-cleanup-in-if-branch", {
      files: {
        "src/Watcher.tsx": `import { useEffect } from "react";

declare const enabled: boolean;
declare const document: { addEventListener: (e: string, h: () => void) => void; removeEventListener: (e: string, h: () => void) => void };

export const Watcher = () => {
  useEffect(() => {
    const handler = () => {};
    if (enabled) {
      document.addEventListener("scroll", handler);
      return () => document.removeEventListener("scroll", handler);
    }
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag cleanup nested inside a try/finally", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-cleanup-in-try", {
      files: {
        "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    try {
      const unsub = store.subscribe(handler);
      return () => unsub();
    } catch {
      // ignore
    }
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  // HACK: ensure the broader walk does NOT credit cleanup returns from a
  // *nested* function expression (e.g. an inner callback) as the effect's
  // own cleanup. The walker stops at function boundaries; this protects
  // the bug fix from over-correcting.
  it("DOES still flag when the only `return cleanup` is inside a nested callback (not the effect's body)", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-nested-fn-return", {
      files: {
        "src/Subscribe.tsx": `import { useEffect } from "react";

declare const store: { subscribe: (handler: () => void) => () => void };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    const make = () => {
      const unsub = store.subscribe(handler);
      return () => unsub();
    };
    make();
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });
});
