import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

// The "you might not need an effect" family assumes a `useState` value is
// written from a React event handler, so the work can be folded into that
// handler (or computed during render). That assumption breaks for state
// driven from an imperative source — a DOM measurement, a browser global, or
// a deferred callback (timer / listener / observer / promise / subscription).
// There is no React handler to move into, and the value can't be produced at
// render time, so flagging effects that REACT to such state is a false
// positive. These regressions pin the discriminators that suppress them.
const tempRoot = createScopedTempRoot("external-state-origin");

describe("effect-family rules: externally-driven / non-render-knowable state", () => {
  it("no-adjust-state-on-prop-change: skips a DOM measurement re-triggered by a prop", async () => {
    const projectDir = setupReactProject(tempRoot, "adjust-dom-measure", {
      files: {
        "src/Box.tsx": `import { useEffect, useRef, useState } from "react";
export const Box = ({ visible }: { visible?: boolean }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (ref.current) setMobile(ref.current.offsetWidth < 600);
  }, [visible]);
  return <div ref={ref}>{mobile ? "m" : "d"}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-adjust-state-on-prop-change")).toHaveLength(0);
  });

  it("no-derived-state: skips a value measured off a ref (can't compute during render)", async () => {
    const projectDir = setupReactProject(tempRoot, "derived-ref-measure", {
      files: {
        "src/Carousel.tsx": `import { useEffect, useRef, useState } from "react";
declare const measure: (el: HTMLElement | null) => number;
export const Carousel = ({ slide }: { slide: number }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setWidth(measure(trackRef.current));
  }, [slide]);
  return <div ref={trackRef}>{width}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-derived-state")).toHaveLength(0);
  });

  it("no-event-handler: skips a guard reading matchMedia-listener state", async () => {
    const projectDir = setupReactProject(tempRoot, "event-handler-matchmedia", {
      files: {
        "src/Theme.tsx": `import { useEffect, useState } from "react";
export const Theme = ({ onChange }: { onChange?: (v: boolean) => void }) => {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    if (dark) onChange?.(dark);
  }, [dark]);
  return <div>{dark ? "dark" : "light"}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-event-handler")).toHaveLength(0);
  });

  it("no-event-handler: skips state set by a useCallback-wrapped resize handler", async () => {
    const projectDir = setupReactProject(tempRoot, "event-handler-usecallback", {
      files: {
        "src/Viewport.tsx": `import { useCallback, useEffect, useState } from "react";
export const Viewport = ({ onResize }: { onResize?: (w: number) => void }) => {
  const [width, setWidth] = useState(0);
  const handleResize = useCallback(() => setWidth(window.innerWidth), []);
  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [handleResize]);
  useEffect(() => {
    if (width > 0) onResize?.(width);
  }, [width]);
  return <div>{width}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-event-handler")).toHaveLength(0);
  });

  it("no-prop-callback-in-effect: skips a parent sync of WebSocket-driven state", async () => {
    const projectDir = setupReactProject(tempRoot, "prop-callback-ws", {
      files: {
        "src/Live.tsx": `import { useEffect, useState } from "react";
export const Live = ({ url, onMsg }: { url: string; onMsg?: (m: unknown) => void }) => {
  const [msg, setMsg] = useState<unknown>(null);
  useEffect(() => {
    const ws = new WebSocket(url);
    ws.onmessage = (e) => setMsg(e.data);
    return () => ws.close();
  }, [url]);
  useEffect(() => {
    if (msg) onMsg?.(msg);
  }, [msg]);
  return <div />;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-prop-callback-in-effect")).toHaveLength(0);
  });

  it("no-chain-state-updates: skips a chain triggered by setInterval-driven state", async () => {
    const projectDir = setupReactProject(tempRoot, "chain-interval", {
      files: {
        "src/Clock.tsx": `import { useEffect, useState } from "react";
export const Clock = () => {
  const [now, setNow] = useState(Date.now());
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (now % 2 === 0) setLate(true);
  }, [now]);
  return <div>{now}{late ? "!" : ""}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-chain-state-updates")).toHaveLength(0);
  });

  it("no-cascading-set-state: does not sum setters inside a deferred inline subscription callback", async () => {
    const projectDir = setupReactProject(tempRoot, "cascade-listener", {
      files: {
        "src/Multi.tsx": `import { useEffect, useState } from "react";
declare const store: { subscribe: (listener: () => void) => () => void };
export const Multi = () => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useEffect(() => {
    return store.subscribe(() => {
      setA(1);
      setB(2);
      setC(3);
    });
  });
  return <div>{a}{b}{c}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-cascading-set-state")).toHaveLength(0);
  });

  it("no-cascading-set-state: does not count setters inside a stored handler the effect only registers", async () => {
    const projectDir = setupReactProject(tempRoot, "cascade-stored-listener", {
      files: {
        "src/Multi.tsx": `import { useEffect, useState } from "react";
export const Multi = () => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useEffect(() => {
    const onResize = () => {
      setA(1);
      setB(2);
      setC(3);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
  return <div>{a}{b}{c}</div>;
};
`,
      },
    });
    expect(await collectRuleHits(projectDir, "no-cascading-set-state")).toHaveLength(0);
  });
});

describe("effect-family rules: genuine smells still fire", () => {
  it("no-pass-live-state-to-parent: flags observer-driven state handed to the parent", async () => {
    const projectDir = setupReactProject(tempRoot, "pass-live-io", {
      files: {
        "src/Lazy.tsx": `import { useEffect, useRef, useState } from "react";
export const Lazy = ({ onShow }: { onShow?: (v: boolean) => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setSeen(true);
    });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (seen) onShow?.(seen);
  }, [seen]);
  return <div ref={ref} />;
};
`,
      },
    });
    expect(
      (await collectRuleHits(projectDir, "no-pass-live-state-to-parent")).length,
    ).toBeGreaterThan(0);
  });

  it("no-derived-state: still flags a value derived purely from props", async () => {
    const projectDir = setupReactProject(tempRoot, "tp-derived-props", {
      files: {
        "src/Name.tsx": `import { useEffect, useState } from "react";
export const Name = ({ first, last }: { first: string; last: string }) => {
  const [full, setFull] = useState("");
  useEffect(() => {
    setFull(first + " " + last);
  }, [first, last]);
  return <div>{full}</div>;
};
`,
      },
    });
    expect((await collectRuleHits(projectDir, "no-derived-state")).length).toBeGreaterThan(0);
  });

  it("no-event-handler: still flags state set only in a click handler", async () => {
    const projectDir = setupReactProject(tempRoot, "tp-event-handler", {
      files: {
        "src/Toggle.tsx": `import { useEffect, useState } from "react";
export const Toggle = ({ onOpen }: { onOpen: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (isOpen) onOpen();
  }, [isOpen]);
  return <button onClick={() => setIsOpen(true)}>open</button>;
};
`,
      },
    });
    expect((await collectRuleHits(projectDir, "no-event-handler")).length).toBeGreaterThan(0);
  });

  it("no-cascading-set-state: still flags a synchronous forEach cascade", async () => {
    const projectDir = setupReactProject(tempRoot, "tp-cascade-foreach", {
      files: {
        "src/Sync.tsx": `import { useEffect, useState } from "react";
export const Sync = ({ items }: { items: number[] }) => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useEffect(() => {
    items.forEach(() => {
      setA(1);
      setB(2);
      setC(3);
    });
  }, [items]);
  return <div>{a}{b}{c}</div>;
};
`,
      },
    });
    expect((await collectRuleHits(projectDir, "no-cascading-set-state")).length).toBeGreaterThan(0);
  });

  // A stored handler registered via addEventListener used to be asserted here
  // as a genuine smell. The FP verification corpus judged that exact shape a
  // false positive (the dossier's largest cluster): the effect only registers
  // the handler, its setters fire later per event, and React batches them into
  // one render — so no cascade occurs on effect execution. That shape is now
  // pinned as silent in no-cascading-set-state.regressions.test.ts and in the
  // suppression suite above. The genuine-smell coverage moved to a stored
  // helper the effect body CALLS synchronously, where the fan-out really does
  // run on the effect's own dispatch.
  it("no-cascading-set-state: flags a stored helper invoked synchronously that fans out over 3 setters", async () => {
    const projectDir = setupReactProject(tempRoot, "tp-cascade-stored-helper", {
      files: {
        "src/Multi.tsx": `import { useEffect, useState } from "react";
export const Multi = ({ id }: { id: string }) => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useEffect(() => {
    const applyAll = () => {
      setA(1);
      setB(2);
      setC(3);
    };
    applyAll();
  }, [id]);
  return <div>{a}{b}{c}</div>;
};
`,
      },
    });
    expect((await collectRuleHits(projectDir, "no-cascading-set-state")).length).toBeGreaterThan(0);
  });

  it("no-cascading-set-state: still flags 3 synchronous setters in the effect body", async () => {
    const projectDir = setupReactProject(tempRoot, "tp-cascade", {
      files: {
        "src/Init.tsx": `import { useEffect, useState } from "react";
export const Init = ({ id }: { id: string }) => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  useEffect(() => {
    setA(1);
    setB(2);
    setC(3);
  }, [id]);
  return <div>{a}{b}{c}</div>;
};
`,
      },
    });
    expect((await collectRuleHits(projectDir, "no-cascading-set-state")).length).toBeGreaterThan(0);
  });
});
