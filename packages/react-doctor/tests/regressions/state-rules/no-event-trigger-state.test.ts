import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-event-trigger-state");

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

  it("does NOT misclassify a user-defined `track(progress)` helper as analytics", async () => {
    // Regression: `track` and `logEvent` used to be in the direct-call
    // allowlist. They're so common as user-helper names (game progress
    // tracking, event tracking) that direct-call detection produced
    // FPs. Detection still works via the receiver shape
    // (`analytics.track(...)`), which is what real analytics SDKs use.
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-user-track", {
      files: {
        "src/Game.tsx": `import { useEffect, useState } from "react";

declare const track: (progress: number) => void;

export const Game = () => {
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    if (progress !== null) {
      track(progress);
    }
  }, [progress]);
  return <button onClick={() => setProgress(50)}>Go</button>;
};
`,
      },
    });

    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(triggerHits.length).toBe(0);
  });

  it("DOES still flag `analytics.track(progress)` member-call as event-triggered analytics", async () => {
    const projectDir = setupReactProject(tempRoot, "no-event-trigger-state-analytics-track", {
      files: {
        "src/Game.tsx": `import { useEffect, useState } from "react";

declare const analytics: { track: (progress: number) => void };

export const Game = () => {
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    if (progress !== null) {
      analytics.track(progress);
    }
  }, [progress]);
  return <button onClick={() => setProgress(50)}>Go</button>;
};
`,
      },
    });

    const triggerHits = await collectRuleHits(projectDir, "no-event-trigger-state");
    expect(triggerHits.length).toBe(1);
    expect(triggerHits[0].message).toContain("analytics.track");
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
