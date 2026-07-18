import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const runVictoryOwnershipCase = (overrides = "") =>
  runRule(
    effectNeedsCleanup,
    `import React from "react";
export const Component = ({ timer, delay }) => {
  const loopID = React.useRef(undefined);
  const delayID = React.useRef(undefined);
  const runID = React.useRef(0);

  React.useEffect(() => {
    const cancel = () => {
      runID.current += 1;
      if (loopID.current !== undefined) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      if (delayID.current !== undefined) {
        clearTimeout(delayID.current);
        delayID.current = undefined;
      }
    };

    const startQueue = (run) => {
      const start = () => {
        ${overrides || "if (run !== runID.current) return;"}
        loopID.current = timer.subscribe(() => {
          if (run !== runID.current) return;
          if (loopID.current !== undefined) {
            timer.unsubscribe(loopID.current);
            loopID.current = undefined;
          }
          startQueue(run);
        }, 1000);
      };

      if (delay) {
        delayID.current = setTimeout(start, delay);
      } else {
        start();
      }
    };

    startQueue(runID.current);
    return cancel;
  }, [delay, timer]);
  return null;
};`,
  );

describe("effect-needs-cleanup Victory nested effect ownership", () => {
  it("accepts a receiver-owned numeric subscription handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer }) => {
  const loopID = React.useRef(undefined);
  React.useEffect(() => {
    loopID.current = timer.subscribe(tick, 1000);
    return () => timer.unsubscribe(loopID.current);
  }, [timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when another receiver releases the numeric subscription handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer, otherTimer }) => {
  const loopID = React.useRef(undefined);
  React.useEffect(() => {
    loopID.current = timer.subscribe(tick, 1000);
    return () => otherTimer.unsubscribe(loopID.current);
  }, [otherTimer, timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a generation-guarded nested subscription owned by the effect", () => {
    const result = runVictoryOwnershipCase();

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a nested queue whose generation advances before each scheduled run", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer, delay }) => {
  const loopID = React.useRef(undefined);
  const timeoutID = React.useRef(undefined);
  const runID = React.useRef(0);
  React.useEffect(() => {
    const stopActiveTimer = () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current);
        timeoutID.current = undefined;
      }
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
    };
    const stepFrame = (currentRunID) => {
      if (currentRunID !== runID.current) return;
      if (loopID.current) {
        timer.unsubscribe(loopID.current);
        loopID.current = undefined;
      }
      traverseQueue();
    };
    const traverseQueue = () => {
      runID.current += 1;
      const currentRunID = runID.current;
      const start = () => {
        if (runID.current !== currentRunID) return;
        timeoutID.current = undefined;
        loopID.current = timer.subscribe(() => stepFrame(currentRunID), 1000);
      };
      if (delay) {
        timeoutID.current = setTimeout(start, delay);
      } else {
        start();
      }
    };
    traverseQueue();
    return stopActiveTimer;
  }, [delay, timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when the nested allocation can reacquire after cancellation", () => {
    const result = runVictoryOwnershipCase("void run;");

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when cleanup advances a different generation", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer }) => {
  const loopID = React.useRef(undefined);
  const delayID = React.useRef(undefined);
  const runID = React.useRef(0);
  const otherRunID = React.useRef(0);
  React.useEffect(() => {
    const start = (run) => {
      if (run !== otherRunID.current) return;
      loopID.current = timer.subscribe(tick, 1000);
    };
    start(otherRunID.current);
    delayID.current = setTimeout(start, 1000, otherRunID.current);
    return () => {
      runID.current += 1;
      timer.unsubscribe(loopID.current);
      clearTimeout(delayID.current);
    };
  }, [timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a conjunction does not guarantee the stale run returns", () => {
    const result = runVictoryOwnershipCase("if (run !== runID.current && delay > 0) return;");

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a Promise callback can invoke the guarded allocator after cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer }) => {
  const loopID = React.useRef(undefined);
  const delayID = React.useRef(undefined);
  const runID = React.useRef(0);
  React.useEffect(() => {
    runID.current += 1;
    const currentRunID = runID.current;
    const start = () => {
      if (currentRunID !== runID.current) return;
      loopID.current = timer.subscribe(tick, 1000);
    };
    start();
    delayID.current = setTimeout(start, 1000);
    Promise.resolve().then(() => start());
    return () => {
      timer.unsubscribe(loopID.current);
      clearTimeout(delayID.current);
    };
  }, [timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when cleanup releases a different retained handle", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer }) => {
  const loopID = React.useRef(undefined);
  const otherLoopID = React.useRef(undefined);
  const runID = React.useRef(0);
  React.useEffect(() => {
    const start = (run) => {
      if (run !== runID.current) return;
      loopID.current = timer.subscribe(tick, 1000);
    };
    start(runID.current);
    return () => {
      runID.current += 1;
      timer.unsubscribe(otherLoopID.current);
    };
  }, [timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the effect omits its returned cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const Component = ({ timer }) => {
  const loopID = React.useRef(undefined);
  const runID = React.useRef(0);
  React.useEffect(() => {
    const start = (run) => {
      if (run !== runID.current) return;
      loopID.current = timer.subscribe(tick, 1000);
    };
    start(runID.current);
  }, [timer]);
  return null;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
