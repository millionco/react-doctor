import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectRafLoopNeedsCancel } from "./effect-raf-loop-needs-cancel.js";

describe("effect-raf-loop-needs-cancel", () => {
  it("flags a named self-rescheduling loop with no cancel", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          let id;
          const loop = () => {
            tick();
            id = requestAnimationFrame(loop);
          };
          id = requestAnimationFrame(loop);
        }, []);
        return null;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline self-rescheduling loop", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          requestAnimationFrame(function tick() {
            update();
            requestAnimationFrame(tick);
          });
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a loop that cancels in cleanup", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Countdown() {
        useEffect(() => {
          let requestId;
          const loop = () => {
            render();
            requestId = requestAnimationFrame(loop);
          };
          requestId = requestAnimationFrame(loop);
          return () => cancelAnimationFrame(requestId);
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a one-shot requestAnimationFrame", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Following() {
        useEffect(() => {
          requestAnimationFrame(() => scrollToTop());
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when cancellation is delegated via an aliased handle in cleanup", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          const { cancelAnimationFrame: cancel } = window;
          let id;
          const loop = () => {
            tick();
            id = requestAnimationFrame(loop);
          };
          id = requestAnimationFrame(loop);
          return () => cancel(id);
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not match cancellation of a shadowed handle binding", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Clock() {
         useEffect(() => {
           let requestId;
           const loop = () => {
             requestId = requestAnimationFrame(loop);
           };
           requestId = requestAnimationFrame(loop);
           return () => {
             const requestId = unrelatedFrameId;
             cancelAnimationFrame(requestId);
           };
         }, []);
         return null;
       }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a throttle that schedules a non-rescheduling frame", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Scroller() {
        useEffect(() => {
          let ticking = false;
          const onScroll = () => {
            if (!ticking) {
              requestAnimationFrame(() => {
                doWork();
                ticking = false;
              });
              ticking = true;
            }
          };
          window.addEventListener('scroll', onScroll);
          return () => window.removeEventListener('scroll', onScroll);
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the one-shot double-rAF wait-for-next-paint idiom used to toggle CSS-transition classes", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function FadeIn() {
        useEffect(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => setVisible(true));
          });
        }, []);
        return null;
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a stop-flag loop whose cleanup flips the boolean the loop checks before rescheduling", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Ticker() {
        useEffect(() => {
          let running = true;
          const loop = () => {
            if (!running) return;
            tick();
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
          return () => {
            running = false;
          };
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "false cleanup blocks a consequent",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active) requestAnimationFrame(frame);",
    },
    {
      name: "false cleanup selects a safe alternate",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active) requestAnimationFrame(frame); else idle();",
    },
    {
      name: "false cleanup blocks an and expression",
      initialValue: true,
      cleanupValue: false,
      schedule: "active && requestAnimationFrame(frame);",
    },
    {
      name: "false cleanup triggers an early return",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (!active) return; requestAnimationFrame(frame);",
    },
    {
      name: "false cleanup triggers an alternate early return",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active) idle(); else return; requestAnimationFrame(frame);",
    },
    {
      name: "false cleanup satisfies a strict equality guard",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active === true) requestAnimationFrame(frame);",
    },
    {
      name: "false cleanup satisfies an inequality guard",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active !== false) requestAnimationFrame(frame);",
    },
    {
      name: "true cleanup blocks a negated consequent",
      initialValue: false,
      cleanupValue: true,
      schedule: "if (!stopped) requestAnimationFrame(frame);",
    },
    {
      name: "true cleanup blocks an or expression",
      initialValue: false,
      cleanupValue: true,
      schedule: "stopped || requestAnimationFrame(frame);",
    },
    {
      name: "true cleanup triggers an early return",
      initialValue: false,
      cleanupValue: true,
      schedule: "if (stopped) return; requestAnimationFrame(frame);",
    },
    {
      name: "a boolean cleanup blocks a nullish fallback",
      initialValue: null,
      cleanupValue: false,
      schedule: "stopped ?? requestAnimationFrame(frame);",
    },
  ])("accepts $name", ({ initialValue, cleanupValue, schedule }) => {
    const guardName = schedule.includes("stopped") ? "stopped" : "active";
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let ${guardName} = ${String(initialValue)};
        const frame = () => {
          ${schedule}
        };
        requestAnimationFrame(frame);
        return () => { ${guardName} = ${String(cleanupValue)}; };
      }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      name: "negated consequent after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (!active) requestAnimationFrame(frame);",
    },
    {
      name: "alternate after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active) idle(); else requestAnimationFrame(frame);",
    },
    {
      name: "or fallback after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "active || requestAnimationFrame(frame);",
    },
    {
      name: "inverted early return after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active) return; requestAnimationFrame(frame);",
    },
    {
      name: "inverted alternate early return after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (!active) idle(); else return; requestAnimationFrame(frame);",
    },
    {
      name: "false equality after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active === false) requestAnimationFrame(frame);",
    },
    {
      name: "true inequality after false cleanup",
      initialValue: true,
      cleanupValue: false,
      schedule: "if (active !== true) requestAnimationFrame(frame);",
    },
    {
      name: "positive consequent after true cleanup",
      initialValue: false,
      cleanupValue: true,
      schedule: "if (stopped) requestAnimationFrame(frame);",
    },
    {
      name: "and expression after true cleanup",
      initialValue: false,
      cleanupValue: true,
      schedule: "stopped && requestAnimationFrame(frame);",
    },
    {
      name: "negated early return after true cleanup",
      initialValue: false,
      cleanupValue: true,
      schedule: "if (!stopped) return; requestAnimationFrame(frame);",
    },
  ])("reports $name", ({ initialValue, cleanupValue, schedule }) => {
    const guardName = schedule.includes("stopped") ? "stopped" : "active";
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let ${guardName} = ${String(initialValue)};
        const frame = () => {
          ${schedule}
        };
        requestAnimationFrame(frame);
        return () => { ${guardName} = ${String(cleanupValue)}; };
      }, []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires the cleanup to unconditionally establish the blocking guard value", () => {
    const conditionalCleanup = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let active = true;
        const frame = () => {
          if (!active) return;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return () => {
          if (shouldStop()) active = false;
        };
      }, []);`,
    );
    const finalStraightLineValue = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let active = true;
        const frame = () => {
          if (!active) return;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return () => {
          active = true;
          active = false;
        };
      }, []);`,
    );
    expect(conditionalCleanup.diagnostics).toHaveLength(1);
    expect(finalStraightLineValue.diagnostics).toHaveLength(0);
  });

  it("does not flag a token-ref-guarded tween loop whose cleanup bumps the ref the step checks", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Tween() {
        const tokenRef = useRef(0);
        useEffect(() => {
          const token = tokenRef.current;
          const step = () => {
            if (tokenRef.current !== token) return;
            advance();
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          return () => {
            tokenRef.current += 1;
          };
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the cleanup is returned as a named identifier that cancels the stored handle", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          const { cancelAnimationFrame: cancel } = window;
          let id;
          const loop = () => {
            tick();
            id = requestAnimationFrame(loop);
          };
          id = requestAnimationFrame(loop);
          const stop = () => cancel(id);
          return stop;
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an uncancellable loop even when an unrelated handler in the component cancels its own rAF throttle", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Chart() {
        const scrollRaf = useRef(0);
        const onScroll = () => {
          cancelAnimationFrame(scrollRaf.current);
          scrollRaf.current = requestAnimationFrame(paint);
        };
        useEffect(() => {
          const loop = () => {
            tick();
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a rAF-free effect", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `
      function Clock() {
        useEffect(() => {
          const id = setInterval(tick, 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: AbortController signal-guarded loop with cleanup abort", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Wave() {
  useEffect(() => {
    const controller = new AbortController();
    const loop = () => {
      if (controller.signal.aborted) return;
      draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => controller.abort();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Cleanup wraps the flag-flipping stop helper in an arrow: return () => stop()", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Spinner() {
  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      rotate();
      requestAnimationFrame(loop);
    };
    const stop = () => {
      active = false;
    };
    requestAnimationFrame(loop);
    return () => stop();
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Session token nested one member level deeper on a ref-held object", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Particles() {
  const sessionRef = useRef({ id: 0 });
  useEffect(() => {
    sessionRef.current.id += 1;
    const sessionId = sessionRef.current.id;
    const loop = () => {
      if (sessionRef.current.id !== sessionId) return;
      step();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => {
      sessionRef.current.id += 1;
    };
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Literal cancelAnimationFrame in cleanup — the rule's own remediation — with the id stored on a nested ref object", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Progress() {
  const animRef = useRef({ rafId: 0, startTime: 0 });
  useEffect(() => {
    animRef.current.startTime = performance.now();
    const loop = () => {
      paint();
      animRef.current.rafId = requestAnimationFrame(loop);
    };
    animRef.current.rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current.rafId);
  }, []);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Flag cleanup returned from inside the enabled branch", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Marquee({ enabled }) {
  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      scrollStep();
      requestAnimationFrame(loop);
    };
    if (enabled) {
      requestAnimationFrame(loop);
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [enabled]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Finite DOM-only smooth-scroll tween on mount", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function ScrollReset({ containerRef }) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const startTop = el.scrollTop;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / 300, 1);
      el.scrollTop = startTop * (1 - t);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [containerRef]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes finite decreasing RAF counters with lower bounds", () => {
    const directLowerBound = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let remainingFrames = 10;
        const step = () => {
          remainingFrames--;
          if (remainingFrames > 0) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const reversedLowerBound = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let remainingFrames = 10;
        const step = () => {
          remainingFrames -= 1;
          if (0 < remainingFrames) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const wrongDirectionBound = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let remainingFrames = 10;
        const step = () => {
          remainingFrames--;
          if (remainingFrames < 100) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const unstableLowerBound = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let remainingFrames = 10;
        const step = () => {
          remainingFrames--;
          if (remainingFrames > minimumFrames) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(directLowerBound.diagnostics).toHaveLength(0);
    expect(reversedLowerBound.diagnostics).toHaveLength(0);
    expect(wrongDirectionBound.diagnostics).toHaveLength(1);
    expect(unstableLowerBound.diagnostics).toHaveLength(1);
  });

  it("requires the reschedule branch to preserve the progress bound", () => {
    const boundedConsequent = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const unboundedAlternate = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          if (frame < 10) finish();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const boundedAlternate = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          if (frame >= 10) finish();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const unboundedConsequent = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          if (frame >= 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(boundedConsequent.diagnostics).toHaveLength(0);
    expect(unboundedAlternate.diagnostics).toHaveLength(1);
    expect(boundedAlternate.diagnostics).toHaveLength(0);
    expect(unboundedConsequent.diagnostics).toHaveLength(1);
  });

  it("compares RAF progress and cleanup guards by binding identity", () => {
    const boundedOuterCounter = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          { let frame = 0; frame = random(); }
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const shadowedProgressCounter = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          { let frame = 0; frame++; }
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const shadowedCleanupGuard = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let active = true;
        const step = () => {
          if (active) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        return () => { { let active = true; active = false; } };
      }, []);`,
    );
    const shadowedStopHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let active = true;
        const stop = () => { active = false; };
        const step = () => {
          if (active) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        return () => { const stop = () => {}; stop(); };
      }, []);`,
    );
    const unusedNonMonotonicHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          const debug = () => { frame = random(); };
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const invokedNonMonotonicHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          const mutate = () => { frame = random(); };
          mutate();
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(boundedOuterCounter.diagnostics).toHaveLength(0);
    expect(shadowedProgressCounter.diagnostics).toHaveLength(1);
    expect(shadowedCleanupGuard.diagnostics).toHaveLength(1);
    expect(shadowedStopHelper.diagnostics).toHaveLength(1);
    expect(unusedNonMonotonicHelper.diagnostics).toHaveLength(0);
    expect(invokedNonMonotonicHelper.diagnostics).toHaveLength(1);
  });

  it("only follows nested reschedules through synchronously invoked helpers", () => {
    const unusedHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        const step = () => {
          const debugLoop = () => requestAnimationFrame(step);
          paint();
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const invokedHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        const step = () => {
          const continueLoop = () => requestAnimationFrame(step);
          paint();
          continueLoop();
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(unusedHelper.diagnostics).toHaveLength(0);
    expect(invokedHelper.diagnostics).toHaveLength(1);
  });

  it("proves progress bounds only from self-rescheduling RAF calls", () => {
    const boundedSelfWithOneShot = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const paintOnce = () => paint();
        const step = () => {
          frame++;
          requestAnimationFrame(paintOnce);
          if (frame < 10) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const unboundedSelfWithBoundedOneShot = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const paintOnce = () => paint();
        const step = () => {
          frame++;
          if (frame < 10) requestAnimationFrame(paintOnce);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(boundedSelfWithOneShot.diagnostics).toHaveLength(0);
    expect(unboundedSelfWithBoundedOneShot.diagnostics).toHaveLength(1);
  });

  it("tracks self-reschedules through callback aliases", () => {
    const boundedAlias = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        let frame = 0;
        const step = () => {
          frame++;
          const continueStep = step;
          if (frame < 10) requestAnimationFrame(continueStep);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    const unboundedAlias = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
        const step = () => {
          const continueStep = step;
          requestAnimationFrame(continueStep);
        };
        requestAnimationFrame(step);
      }, []);`,
    );
    expect(boundedAlias.diagnostics).toHaveLength(0);
    expect(unboundedAlias.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Custom useRafLoop hook whose cleanup invokes the stop closure through a ref", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `const useRafLoop = (onFrame) => {
  const stopRef = useRef(() => {});
  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      onFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    stopRef.current = () => {
      active = false;
    };
    return () => stopRef.current();
  }, [onFrame]);
  return stopRef;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Frame ids collected in a Map and every one cancelled in cleanup", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Confetti({ pieces }) {
  useEffect(() => {
    const frameIds = new Map();
    pieces.forEach((piece) => {
      const loop = () => {
        movePiece(piece);
        frameIds.set(piece.id, requestAnimationFrame(loop));
      };
      frameIds.set(piece.id, requestAnimationFrame(loop));
    });
    return () => {
      frameIds.forEach((frameId) => cancelAnimationFrame(frameId));
    };
  }, [pieces]);
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: WebGL init in try/catch with the flag cleanup returned from the try block", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function GlScene() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    try {
      const gl = canvas.getContext('webgl');
      if (!gl) return;
      const loop = () => {
        if (!active) return;
        renderScene(gl);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      return () => {
        active = false;
      };
    } catch (error) {
      console.error(error);
      return undefined;
    }
  }, []);
  return <canvas ref={canvasRef} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an uncancelled loop with an unrelated cleanup call", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Ticker() {
         useEffect(() => {
           const loop = () => {
             tick();
             requestAnimationFrame(loop);
           };
           requestAnimationFrame(loop);
           return () => resetOtherThing();
         }, []);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when cleanup calls an unrelated method on a guarded object", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Ticker() {
         useEffect(() => {
           const state = { running: true, teardown() {} };
           const loop = () => {
             if (!state.running) return;
             tick();
             requestAnimationFrame(loop);
           };
           requestAnimationFrame(loop);
           return () => state.teardown();
         }, []);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: RAF loop started from a later event callback", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `const Logo = () => {
        useEffect(() => {
          const handleMove = (x, y) => {
            let velocityX = 0;
            let velocityY = 0;
            const animate = () => {
              velocityX = velocityX * 0.8 + x;
              velocityY = velocityY * 0.8 + y;
              el.setAttribute("cx", String(velocityX));
              if (Math.abs(velocityX) > 0.1 || Math.abs(velocityY) > 0.1) {
                requestAnimationFrame(animate);
              }
            };
            requestAnimationFrame(animate);
          };
          window.addEventListener("mousemove", handleMove);
          return () => window.removeEventListener("mousemove", handleMove);
        }, []);
        return null;
      };`,
      { filename: "logo.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an uncancelled RAF loop started inside a synchronous iterator callback", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `function Ticker() {
         useEffect(() => {
           [canvas].forEach(() => {
             const loop = () => {
               tick();
               requestAnimationFrame(loop);
             };
             requestAnimationFrame(loop);
           });
         }, []);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows wrapped helpers and iterator callees that start RAF loops", () => {
    const wrappedHelper = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         const loop = () => requestAnimationFrame(loop);
         const start = () => requestAnimationFrame(loop);
         (start as typeof start)();
       }, []);`,
    );
    const wrappedIterator = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         const loop = () => requestAnimationFrame(loop);
         ([null].forEach as typeof Array.prototype.forEach)(
           () => requestAnimationFrame(loop),
         );
       }, []);`,
    );
    expect(wrappedHelper.diagnostics).toHaveLength(1);
    expect(wrappedIterator.diagnostics).toHaveLength(1);
  });

  it("tracks static computed animation-frame lifecycle methods", () => {
    const acquireOnly = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         const loop = () => window["requestAnimationFrame"](loop);
         window["requestAnimationFrame"](loop);
       }, []);`,
    );
    const matchingRelease = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         let frameId;
         const loop = () => { frameId = window["requestAnimationFrame"](loop); };
         frameId = window["requestAnimationFrame"](loop);
         return () => window[\`cancelAnimationFrame\`](frameId);
       }, []);`,
    );
    const wrongRelease = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         let frameId;
         const loop = () => { frameId = window["requestAnimationFrame"](loop); };
         frameId = window["requestAnimationFrame"](loop);
         return () => window[\`cancelAnimationFrame\`](otherFrameId);
       }, []);`,
    );
    expect(acquireOnly.diagnostics).toHaveLength(1);
    expect(matchingRelease.diagnostics).toHaveLength(0);
    expect(wrongRelease.diagnostics).toHaveLength(1);
  });

  it("does not confuse a nested callback parameter with the RAF loop binding", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         function frame() {
           const schedule = (frame) => requestAnimationFrame(frame);
           schedule(() => {});
         }
         requestAnimationFrame(frame);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires the cleanup guard to dominate every recursive schedule", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         let active = true;
         const frame = () => {
           if (active) tick();
           requestAnimationFrame(frame);
         };
         requestAnimationFrame(frame);
         return () => { active = false; };
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects a cancellation handle overwritten after every schedule", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         let frameId;
         const frame = () => {
           frameId = requestAnimationFrame(frame);
           frameId = 0;
         };
         frameId = requestAnimationFrame(frame);
         frameId = 0;
         return () => cancelAnimationFrame(frameId);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an earlier handle write that every schedule replaces", () => {
    const result = runRule(
      effectRafLoopNeedsCancel,
      `useEffect(() => {
         let frameId;
         const frame = () => {
           frameId = 0;
           frameId = requestAnimationFrame(frame);
         };
         frameId = 0;
         frameId = requestAnimationFrame(frame);
         return () => cancelAnimationFrame(frameId);
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
