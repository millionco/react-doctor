import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaleTimerRef } from "./no-stale-timer-ref.js";

describe("no-stale-timer-ref", () => {
  it("flags a hide handler that clears without resetting when an effect reads the ref as pending", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Tooltip = ({ delayShow }) => {
        const showTimerRef = useRef(null);
        const scheduleShow = (delay) => {
          showTimerRef.current = setTimeout(() => {
            showTimerRef.current = null;
            show();
          }, delay);
        };
        const handleHide = () => {
          if (showTimerRef.current) {
            clearTimeout(showTimerRef.current);
          }
        };
        useEffect(() => {
          if (showTimerRef.current) {
            scheduleShow(delayShow);
          }
        }, [delayShow]);
        return <button onMouseLeave={handleHide}>anchor</button>;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("showTimerRef.current");
    expect(result.diagnostics[0].message).toContain("= null");
  });

  it("flags a cancel function in a custom hook when scheduling early-returns on the truthy ref", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const useDelayedCallback = (callback) => {
        const timerRef = useRef(null);
        const schedule = () => {
          if (timerRef.current) return;
          timerRef.current = setTimeout(callback, 100);
        };
        const cancel = () => {
          clearTimeout(timerRef.current);
        };
        return { schedule, cancel };
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `window.clearTimeout` when the ref feeds a ternary pending display", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const SaveIndicator = ({ save }) => {
        const timerRef = useRef(null);
        const statusLabel = timerRef.current ? "saving soon" : "idle";
        const start = () => {
          timerRef.current = window.setTimeout(save, 500);
        };
        const stop = () => {
          window.clearTimeout(timerRef.current);
        };
        return <span onClick={stop} onFocus={start}>{statusLabel}</span>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `clearInterval` when a `!ref.current` guard gates re-scheduling", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Poller = ({ poll }) => {
        const intervalRef = useRef(null);
        useEffect(() => {
          if (!intervalRef.current) {
            intervalRef.current = setInterval(poll, 1000);
          }
        });
        const pause = () => {
          clearInterval(intervalRef.current);
        };
        return <button onClick={pause}>pause</button>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags through a TS non-null assertion on the cleared ref", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = () => {
        const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const isArmed = timerRef.current !== null;
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          clearTimeout(timerRef.current!);
        };
        return <input readOnly value={String(isArmed)} onFocus={arm} onBlur={disarm} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags every clear site that leaves the id behind", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = () => {
        const timerRef = useRef(null);
        const schedule = () => {
          if (timerRef.current) return;
          timerRef.current = setTimeout(fire, 10);
        };
        const cancelFromHeader = () => {
          clearTimeout(timerRef.current);
        };
        const cancelFromFooter = () => {
          clearTimeout(timerRef.current);
        };
        return <div onMouseDown={cancelFromHeader} onMouseUp={cancelFromFooter} onClick={schedule} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet when the clear is followed by a null reset", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Tooltip = ({ delayShow }) => {
        const showTimerRef = useRef(null);
        const handleHide = () => {
          if (showTimerRef.current) {
            clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
          }
        };
        useEffect(() => {
          if (showTimerRef.current) {
            reschedule(delayShow);
          }
        }, [delayShow]);
        return <button onMouseLeave={handleHide}>anchor</button>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on the debounce shape that clears then immediately re-arms", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Search = ({ onQuery }) => {
        const debounceRef = useRef(null);
        const isDebouncing = debounceRef.current != null;
        const handleChange = (event) => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => onQuery(event.target.value), 300);
        };
        return <input onChange={handleChange} data-busy={isDebouncing} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the only conditional reads are the clear-guard idiom", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Toast = ({ dismiss }) => {
        const timerRef = useRef(null);
        const arm = () => {
          timerRef.current = setTimeout(dismiss, 3000);
        };
        const disarm = () => {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
        };
        return <div onMouseEnter={disarm} onMouseLeave={arm} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the guard idiom is spelled as a logical AND", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ fire }) => {
        const timerRef = useRef(null);
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          timerRef.current && clearTimeout(timerRef.current);
        };
        return <div onFocus={arm} onBlur={disarm} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a clear inside an effect cleanup return (v1 non-goal)", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Comp = ({ tick, delay }) => {
        const timerRef = useRef(null);
        const isPending = timerRef.current ? "yes" : "no";
        useEffect(() => {
          timerRef.current = setTimeout(tick, delay);
          return () => {
            clearTimeout(timerRef.current);
          };
        }, [tick, delay]);
        return <span>{isPending}</span>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a named cleanup function returned from the effect", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Comp = ({ tick }) => {
        const timerRef = useRef(null);
        const isPending = timerRef.current ? "yes" : "no";
        useEffect(() => {
          timerRef.current = setTimeout(tick, 100);
          const cancelPendingTick = () => {
            clearTimeout(timerRef.current);
          };
          return cancelPendingTick;
        }, [tick]);
        return <span>{isPending}</span>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a component-level cleanup function returned from the effect", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useEffect, useRef } from "react";
      const Comp = ({ tick, delay }) => {
        const timerRef = useRef(null);
        const isPending = timerRef.current ? "yes" : "no";
        const stop = () => {
          clearTimeout(timerRef.current);
        };
        useEffect(() => {
          timerRef.current = setTimeout(tick, delay);
          return stop;
        }, [tick, delay]);
        return <span>{isPending}</span>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the binding is not a useRef ref", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      const Comp = ({ fire }) => {
        const timerBox = { current: null };
        const armed = timerBox.current ? "armed" : "idle";
        timerBox.current = setTimeout(fire, 10);
        clearTimeout(timerBox.current);
        return <span>{armed}</span>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ref never holds a locally scheduled timer", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ externalTimerId }) => {
        const idRef = useRef(externalTimerId);
        const hasHandle = idRef.current ? "yes" : "no";
        const stop = () => {
          clearTimeout(idRef.current);
        };
        return <button onClick={stop}>{hasHandle}</button>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when `clearTimeout` is a locally shadowed binding", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      import { clearTimeout } from "./custom-scheduler";
      const Comp = ({ fire }) => {
        const timerRef = useRef(null);
        const pending = timerRef.current ? 1 : 0;
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          clearTimeout(timerRef.current);
        };
        return <div onFocus={arm} onBlur={disarm}>{pending}</div>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the timer id is cleared through a local alias (v1 non-goal)", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ fire }) => {
        const timerRef = useRef(null);
        const pending = timerRef.current ? 1 : 0;
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          const id = timerRef.current;
          if (id) {
            clearTimeout(id);
          }
        };
        return <div onFocus={arm} onBlur={disarm}>{pending}</div>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a shadowing parameter reuses the ref name", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ fire }) => {
        const timerRef = useRef(null);
        const pending = timerRef.current ? 1 : 0;
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = (timerRef) => {
          clearTimeout(timerRef.current);
        };
        return <div onFocus={arm} onBlur={disarm}>{pending}</div>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a local non-ref binding shadows the useRef name", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ fire, getTimerBox }) => {
        const timerRef = useRef(null);
        const pending = timerRef.current ? 1 : 0;
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          const timerRef = getTimerBox();
          clearTimeout(timerRef.current);
        };
        return <div onFocus={arm} onBlur={disarm}>{pending}</div>;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the ref is only read non-conditionally", () => {
    const result = runRule(
      noStaleTimerRef,
      `
      import { useRef } from "react";
      const Comp = ({ fire }) => {
        const timerRef = useRef(null);
        const arm = () => {
          timerRef.current = setTimeout(fire, 10);
        };
        const disarm = () => {
          clearTimeout(timerRef.current);
          console.log("cleared", timerRef.current);
        };
        return <div onFocus={arm} onBlur={disarm} />;
      };
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
