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

  it("does NOT flag React Native subscription objects cleaned up with `.remove()`", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-rn-sub-remove", {
      packageJsonExtras: {
        dependencies: {
          react: "19.0.0",
          "react-native": "0.82.0",
        },
      },
      files: {
        "src/AppFocus.tsx": `import { useEffect } from "react";
import { AppState } from "react-native";

declare const focusManager: { setFocused: (focused: boolean) => void };

export const AppFocus = () => {
  useEffect(() => {
    const sub = AppState.addEventListener("change", status => {
      focusManager.setFocused(status === "active");
    });
    return () => {
      sub.remove();
    };
  }, []);
  return null;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("recognizes release methods on objects returned by subscribe-like calls", async () => {
    for (const releaseName of ["remove", "cleanup", "dispose", "destroy", "teardown"]) {
      const projectDir = setupReactProject(
        tempRoot,
        `effect-needs-cleanup-bound-resource-${releaseName}`,
        {
          files: {
            "src/Subscribe.tsx": `import { useEffect } from "react";

declare const source: { addListener: (handler: () => void) => { ${releaseName}: () => void } };
declare const handler: () => void;

export const Subscribe = () => {
  useEffect(() => {
    const subscription = source.addListener(handler);
    return () => {
      subscription.${releaseName}();
    };
  }, []);
  return null;
};
`,
          },
        },
      );

      const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
      expect(hits).toHaveLength(0);
    }
  });

  it("does NOT flag bound subscription cleanup inside a conditional branch", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-bound-conditional", {
      files: {
        "src/ConditionalSubscribe.tsx": `import { useEffect } from "react";

declare const isOn: boolean;
declare const source: { addListener: (handler: () => void) => { remove: () => void } };
declare const handler: () => void;

export const ConditionalSubscribe = () => {
  useEffect(() => {
    if (isOn) {
      const sub = source.addListener(handler);
      return () => sub.remove();
    }
  }, [isOn]);
  return null;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when a cleanup function returns an unrecognized release shape", async () => {
    for (const releaseName of ["remove", "cleanup", "dispose", "destroy", "teardown"]) {
      const projectDir = setupReactProject(
        tempRoot,
        `effect-needs-cleanup-unrelated-${releaseName}`,
        {
          files: {
            "src/Resize.tsx": `import { useEffect } from "react";

declare const node: { ${releaseName}: () => void };

export const Resize = () => {
  useEffect(() => {
    window.addEventListener("resize", () => {});
    return () => {
      node.${releaseName}();
    };
  }, []);
  return null;
};
`,
          },
        },
      );

      const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
      expect(hits).toHaveLength(0);
    }
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

  it("does not flag a timer cleaned up by a local function returned by identifier", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-return-local-clear", {
      files: {
        "src/Clock.tsx": `import { useEffect, useRef, useState } from "react";

export const Clock = () => {
  const [, setTick] = useState(0);
  const intervalIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const startInterval = () => {
      if (intervalIdRef.current) return;
      intervalIdRef.current = setInterval(() => setTick((state) => state + 1), 1000);
    };
    const stopInterval = () => {
      if (!intervalIdRef.current) return;
      clearInterval(intervalIdRef.current);
      intervalIdRef.current = null;
    };
    startInterval();
    return stopInterval;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a listener cleaned up by an optionally called local cleanup variable", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-optional-cleanup", {
      files: {
        "src/Resolution.tsx": `import { useEffect } from "react";

declare const win: Window;
declare const updatePixelRatio: () => void;

export const Resolution = () => {
  useEffect(() => {
    let remove: (() => void) | null = null;
    const subscribe = () => {
      const media = win.matchMedia("(resolution: 1dppx)");
      media.addEventListener("change", updatePixelRatio);
      remove = () => {
        media.removeEventListener("change", updatePixelRatio);
      };
    };
    subscribe();
    return () => {
      remove?.();
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

  it("does not flag a subscription cleaned up by a returned local function declaration", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-function-declaration", {
      files: {
        "src/Emitter.tsx": `import { useEffect } from "react";

declare const emitter: { on: (eventName: string, handler: () => void) => void; off: (eventName: string, handler: () => void) => void };
declare const handler: () => void;

export const Emitter = () => {
  useEffect(() => {
    emitter.on("change", handler);
    function cleanup() {
      emitter.off("change", handler);
    }
    return cleanup;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does not flag listeners cleaned up inside an iteration callback", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-for-each-cleanup", {
      files: {
        "src/Pointer.tsx": `import { useEffect } from "react";

declare const handler: () => void;
declare const target: { addEventListener: (eventName: string, handler: () => void) => void; removeEventListener: (eventName: string, handler: () => void) => void };

export const Pointer = () => {
  useEffect(() => {
    const eventNames = ["pointerdown", "mousedown"];
    eventNames.forEach((eventName) => {
      target.addEventListener(eventName, handler);
    });
    return () => {
      eventNames.forEach((eventName) => {
        target.removeEventListener(eventName, handler);
      });
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

  it("does not flag timers cleaned up inside a reduce callback", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-reduce-cleanup", {
      files: {
        "src/Timers.tsx": `import { useEffect } from "react";

declare const tick: () => void;

export const Timers = () => {
  useEffect(() => {
    const timerIds = [setTimeout(tick, 1000), setTimeout(tick, 2000)];
    return () => {
      timerIds.reduce((count, timerId) => {
        clearTimeout(timerId);
        return count + 1;
      }, 0);
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

  it("does not flag timers cleaned up inside an Array.from callback", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-array-from-cleanup", {
      files: {
        "src/Timers.tsx": `import { useEffect } from "react";

declare const tick: () => void;

export const Timers = () => {
  useEffect(() => {
    const timerIds = [setTimeout(tick, 1000), setTimeout(tick, 2000)];
    return () => {
      Array.from(timerIds, (timerId) => {
        clearTimeout(timerId);
      });
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

  it("does not flag a subscription chain binding cleaned up with `.stop()`", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-bound-stop-cleanup", {
      files: {
        "src/Simulation.tsx": `import { useEffect } from "react";

declare const forceSimulation: () => { on: (eventName: string, handler: () => void) => { stop: () => void } };
declare const tick: () => void;

export const Simulation = () => {
  useEffect(() => {
    const simulation = forceSimulation().on("tick", tick);
    return () => {
      simulation.stop();
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

  it("does not flag listener cleanup expressed as `.on(name, null)`", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-on-null-cleanup", {
      files: {
        "src/Zoom.tsx": `import { useEffect } from "react";

declare const zoom: { on: (eventName: string, handler: (() => void) | null) => void };
declare const update: () => void;

export const Zoom = () => {
  useEffect(() => {
    zoom.on("zoom", update);
    return () => {
      zoom.on("zoom", null);
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

  it("does NOT flag a returned opaque local cleanup function", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-return-opaque-cleanup", {
      files: {
        "src/Clock.tsx": `import { useEffect } from "react";

declare const track: () => void;

export const Clock = () => {
  useEffect(() => {
    setInterval(track, 1000);
    const stopInterval = () => {
      track();
    };
    return stopInterval;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the effect returns an opaque cleanup binding", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-opaque-cleanup-binding", {
      files: {
        "src/Clock.tsx": `import { useEffect } from "react";

declare const tick: () => void;

export const Clock = () => {
  useEffect(() => {
    const id = setInterval(tick, 1000);
    let stopInterval: (() => void) | undefined;
    const install = () => {
      const stopInterval = () => clearInterval(id);
      return stopInterval;
    };
    install();
    return stopInterval;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag expression-body arrow whose subscribe return is the implicit cleanup (Bugbot #157)", async () => {
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

  it("flags expression-body `addEventListener` because it does not return cleanup", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-expression-add-listener", {
      files: {
        "src/Resize.tsx": `import { useEffect } from "react";

declare const handler: () => void;

export const Resize = () => {
  useEffect(() => window.addEventListener("resize", handler), []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag a `setTimeout` that lives inside the cleanup return (Bugbot #157 round 3)", async () => {
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

  it("flags a BlockStatement that returns `addEventListener` directly", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-return-add-listener", {
      files: {
        "src/Resize.tsx": `import { useEffect } from "react";

declare const handler: () => void;

export const Resize = () => {
  useEffect(() => {
    return window.addEventListener("resize", handler);
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });

  it("flags an `addEventListener` result binding returned directly", async () => {
    const projectDir = setupReactProject(
      tempRoot,
      "effect-needs-cleanup-return-add-listener-binding",
      {
        files: {
          "src/Resize.tsx": `import { useEffect } from "react";

declare const target: { addEventListener: (eventName: string, handler: () => void) => void };
declare const handler: () => void;

export const Resize = () => {
  useEffect(() => {
    const subscription = target.addEventListener("resize", handler);
    return subscription;
  }, []);
  return <span />;
};
`,
        },
      },
    );

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });

  it("still flags when a subscribed effect returns null", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-return-null", {
      files: {
        "src/Resize.tsx": `import { useEffect } from "react";

declare const handler: () => void;

export const Resize = () => {
  useEffect(() => {
    window.addEventListener("resize", handler);
    return null;
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
  });

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

  it("still flags when an early guard cleanup runs before a later timer", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-early-guard-noop", {
      files: {
        "src/Clock.tsx": `import { useEffect } from "react";

declare const disabled: boolean;
declare const tick: () => void;

export const Clock = () => {
  useEffect(() => {
    if (disabled) return () => {};
    setInterval(tick, 1000);
  }, [disabled]);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("setInterval");
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

  it("does NOT flag `addEventListener({ signal })` cleaned up via `controller.abort()`", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-abort-controller", {
      files: {
        "src/FileDrop.tsx": `import { useEffect } from "react";

declare const handleDragEnter: (event: DragEvent) => void;
declare const handleDragLeave: (event: DragEvent) => void;
declare const handleDragOver: (event: DragEvent) => void;
declare const handleDrop: (event: DragEvent) => void;

export const FileDrop = () => {
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    window.addEventListener("dragenter", handleDragEnter, { signal });
    window.addEventListener("dragleave", handleDragLeave, { signal });
    window.addEventListener("dragover", handleDragOver, { signal });
    window.addEventListener("drop", handleDrop, { signal });
    return () => controller.abort();
  }, []);
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "effect-needs-cleanup");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `addEventListener({ signal })` cleaned up via a block calling `controller.abort()`", async () => {
    const projectDir = setupReactProject(tempRoot, "effect-needs-cleanup-abort-controller-block", {
      files: {
        "src/FileDrop.tsx": `import { useEffect } from "react";

declare const onResize: () => void;

export const FileDrop = () => {
  useEffect(() => {
    const controller = new AbortController();
    window.addEventListener("resize", onResize, { signal: controller.signal });
    return () => {
      controller.abort();
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
