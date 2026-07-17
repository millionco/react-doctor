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
});
