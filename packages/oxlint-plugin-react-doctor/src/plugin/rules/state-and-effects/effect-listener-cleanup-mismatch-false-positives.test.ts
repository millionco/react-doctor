import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectListenerCleanupMismatch } from "./effect-listener-cleanup-mismatch.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(
    effectListenerCleanupMismatch,
    `import { useEffect } from "react";\n${code}`,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

const expectNoDiagnostics = (code: string): void => expectDiagnosticCount(code, 0);

describe("effect-listener-cleanup-mismatch false-positive regressions", () => {
  const setupAbortCases = [
    {
      name: "a controller aborted before registration",
      code: `useEffect(() => {
        const controller = new AbortController();
        controller.abort();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
    },
    {
      name: "a controller aborted after registration",
      code: `useEffect(() => {
        const controller = new AbortController();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        controller.abort();
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
    },
    {
      name: "a controller guarded and aborted during setup",
      code: `useEffect(() => {
        const controller = new AbortController();
        if (!controller.signal.aborted) controller.abort();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
    },
  ];

  for (const testCase of setupAbortCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectNoDiagnostics(testCase.code);
    });
  }

  const guaranteedCleanupCases = [
    {
      name: "an abort in a literal-true branch",
      cleanup: `if (true) controller.abort();`,
    },
    {
      name: "an abort in the left side of a logical expression",
      cleanup: `(controller.abort(), shouldFinish) && finish();`,
    },
    {
      name: "an abort in a conditional test",
      cleanup: `(controller.abort(), shouldFinish) ? finish() : fallback();`,
    },
    {
      name: "an abort in an if test",
      cleanup: `if ((controller.abort(), shouldFinish)) finish();`,
    },
    {
      name: "an abort in a finally block",
      cleanup: `try {
        finish();
      } finally {
        controller.abort();
      }`,
    },
    {
      name: "an idempotent guarded abort",
      cleanup: `if (!controller.signal.aborted) controller.abort();`,
    },
    {
      name: "an idempotent binary-comparison abort guard",
      cleanup: `if (controller.signal.aborted === false) controller.abort();`,
    },
    {
      name: "an idempotent logical abort guard",
      cleanup: `controller.signal.aborted || controller.abort();`,
    },
  ];

  for (const testCase of guaranteedCleanupCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectNoDiagnostics(`useEffect(() => {
        const controller = new AbortController();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          ${testCase.cleanup}
        };
      }, [shouldFinish]);`);
    });
  }

  const guaranteedRemovalCases = [
    {
      name: "a matching removal in a literal-true branch",
      cleanup: `if (true) window.removeEventListener("resize", handleResize);`,
    },
    {
      name: "a matching removal in a finally block",
      cleanup: `try {
        finish();
      } finally {
        window.removeEventListener("resize", handleResize);
      }`,
    },
  ];

  for (const testCase of guaranteedRemovalCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectNoDiagnostics(`useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          ${testCase.cleanup}
        };
      }, []);`);
    });
  }

  it("stays quiet when a local helper aborts the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const controller = new AbortController();
      const abortListener = () => controller.abort();
      window.addEventListener("resize", () => resize(), { signal: controller.signal });
      return () => {
        window.removeEventListener("resize", () => resize());
        abortListener();
      };
    }, []);`);
  });

  it("stays quiet when a signal alias guards the abort", () => {
    expectNoDiagnostics(`useEffect(() => {
      const controller = new AbortController();
      const signal = controller.signal;
      window.addEventListener("resize", () => resize(), { signal });
      return () => {
        window.removeEventListener("resize", () => resize());
        if (!signal.aborted) controller.abort();
      };
    }, []);`);
  });

  it("stays quiet when a local helper removes the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      const removeListener = () => window.removeEventListener("resize", handleResize);
      window.addEventListener("resize", handleResize);
      return () => {
        window.removeEventListener("resize", () => resize());
        removeListener();
      };
    }, []);`);
  });

  it("stays quiet when a bound abort method aborts the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const controller = new AbortController();
      const abortListener = controller.abort.bind(controller);
      window.addEventListener("resize", () => resize(), { signal: controller.signal });
      return () => {
        window.removeEventListener("resize", () => resize());
        abortListener();
      };
    }, []);`);
  });

  const deferredHelperCases = [
    {
      name: "an async helper",
      helper: `const abortLater = async () => {
        await waitForCleanup();
        controller.abort();
      };`,
      call: `void abortLater();`,
    },
    {
      name: "a generator helper",
      helper: `function* abortLater() {
        controller.abort();
      }`,
      call: `abortLater();`,
    },
  ];

  for (const testCase of deferredHelperCases) {
    it(`does not treat ${testCase.name} as synchronous cleanup`, () => {
      expectDiagnosticCount(
        `useEffect(() => {
          const controller = new AbortController();
          ${testCase.helper}
          window.addEventListener("resize", () => resize(), { signal: controller.signal });
          return () => {
            window.removeEventListener("resize", () => resize());
            ${testCase.call}
          };
        }, []);`,
        1,
      );
    });
  }

  it("stays quiet when exhaustive branches remove the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize);
      return () => {
        if (isEnabled) {
          window.removeEventListener("resize", handleResize);
        } else {
          window.removeEventListener("resize", handleResize);
        }
        window.removeEventListener("resize", () => resize());
      };
    }, [isEnabled]);`);
  });

  it("stays quiet when exhaustive branches use equivalent cancellation mechanisms", () => {
    expectNoDiagnostics(`useEffect(() => {
      const controller = new AbortController();
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize, {
        signal: controller.signal,
      });
      return () => {
        if (shouldAbort) {
          controller.abort();
        } else {
          window.removeEventListener("resize", handleResize);
        }
        window.removeEventListener("resize", () => resize());
      };
    }, [shouldAbort]);`);
  });

  it("stays quiet when exhaustive setup branches abort the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const controller = new AbortController();
      window.addEventListener("resize", () => resize(), {
        signal: controller.signal,
      });
      if (shouldAbort) {
        controller.abort();
      } else {
        controller.abort();
      }
      return () => window.removeEventListener("resize", () => resize());
    }, [shouldAbort]);`);
  });

  it("stays quiet when a guaranteed non-empty loop removes the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize);
      return () => {
        for (const cleanupListener of [handleResize]) {
          window.removeEventListener("resize", cleanupListener);
        }
        window.removeEventListener("resize", () => resize());
      };
    }, []);`);
  });

  it("still reports when an empty loop cannot remove the registration", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          for (const cleanupListener of []) {
            window.removeEventListener("resize", cleanupListener);
          }
          window.removeEventListener("resize", () => resize());
        };
      }, []);`,
      1,
    );
  });

  it("stays quiet when a returned cleanup alias calls a removal helper", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      const removeListener = () => window.removeEventListener("resize", handleResize);
      const cleanup = () => {
        removeListener();
        window.removeEventListener("resize", () => resize());
      };
      window.addEventListener("resize", handleResize);
      return cleanup;
    }, []);`);
  });

  it("stays quiet when another static target path removes the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const targets = { first: window, second: window };
      const handleResize = () => resize();
      targets.first.addEventListener("resize", handleResize);
      targets.second.addEventListener("resize", handleResize);
      return () => {
        targets.first.removeEventListener("resize", () => resize());
        targets.second.removeEventListener("resize", handleResize);
      };
    }, []);`);
  });

  it("stays quiet when a stable target snapshot removes the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const holder = { current: new EventTarget() };
      const originalTarget = holder.current;
      const handleChange = () => change();
      holder.current.addEventListener("change", handleChange);
      holder.current = new EventTarget();
      return () => {
        originalTarget.removeEventListener("change", handleChange);
        holder.current.removeEventListener("change", () => change());
      };
    }, []);`);
  });

  it("does not treat different global targets as aliases", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          document.removeEventListener("resize", handleResize);
        };
      }, []);`,
      1,
    );
  });

  it("stays quiet when a const-computed method removes the registration", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      const removalMethod = "removeEventListener";
      window.addEventListener("resize", handleResize);
      return () => {
        window[removalMethod]("resize", handleResize);
        window.removeEventListener("resize", () => resize());
      };
    }, []);`);
  });

  it("stays quiet when a destructured method removes the registration with its receiver", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      const { removeEventListener } = window;
      window.addEventListener("resize", handleResize);
      return () => {
        removeEventListener.call(window, "resize", handleResize);
        window.removeEventListener("resize", () => resize());
      };
    }, []);`);
  });

  it("does not trust a mutable destructured removal method", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        let { removeEventListener } = window;
        removeEventListener = () => {};
        window.addEventListener("resize", handleResize);
        return () => {
          removeEventListener.call(window, "resize", handleResize);
          window.removeEventListener("resize", () => resize());
        };
      }, []);`,
      1,
    );
  });

  it("stays quiet when a once listener is synchronously consumed", () => {
    expectNoDiagnostics(`useEffect(() => {
      const target = new EventTarget();
      target.addEventListener("change", () => {}, { once: true });
      target.dispatchEvent(new Event("change"));
      return () => target.removeEventListener("change", () => change());
    }, []);`);
  });

  it("still reports a once listener that is not synchronously consumed", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize, { once: true });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      1,
    );
  });

  it("does not treat an overwritten once option as true", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const target = new EventTarget();
        const handleChange = () => change();
        target.addEventListener("change", handleChange, {
          once: true,
          once: false,
        });
        target.dispatchEvent(new Event("change"));
        return () => target.removeEventListener("change", () => change());
      }, []);`,
      1,
    );
  });

  it("does not assume an untracked blocker lets a once listener run", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const target = new EventTarget();
        const blockers = [(event) => event.stopImmediatePropagation()];
        const handleChange = () => change();
        target.addEventListener("change", blockers[0]);
        target.addEventListener("change", handleChange, { once: true });
        target.dispatchEvent(new Event("change"));
        return () => target.removeEventListener("change", () => change());
      }, []);`,
      1,
    );
  });

  it("does not assume an indirectly re-registering once listener was consumed", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const target = new EventTarget();
        const registerAgain = () => {
          target.addEventListener("change", handleChange, { once: true });
        };
        const handleChange = () => registerAgain();
        target.addEventListener("change", handleChange, { once: true });
        target.dispatchEvent(new Event("change"));
        return () => target.removeEventListener("change", () => {});
      }, []);`,
      1,
    );
  });

  it("does not let an unrelated loop exit hide a mismatch", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          for (;;) break;
        };
      }, []);`,
      1,
    );
  });

  it("does not inline an overridable cleanup parameter default", () => {
    expectDiagnosticCount(
      `const controller = new AbortController();
      const useResize = (cleanup = () => controller.abort()) => {
        useEffect(() => {
          window.addEventListener("resize", () => resize(), {
            signal: controller.signal,
          });
          return () => {
            window.removeEventListener("resize", () => resize());
            cleanup();
          };
        }, [cleanup]);
      };`,
      1,
    );
  });

  it("does not treat a setup removal before registration as cleanup", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const handleResize = () => resize();
        window.removeEventListener("resize", handleResize);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      1,
    );
  });

  it("does not let an unrelated setup abort suppress a mismatch", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        externalController.abort();
        const controller = new AbortController();
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize, {
          signal: controller.signal,
        });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      1,
    );
  });

  it("stays quiet for equivalent global target paths", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleClick = () => click();
      window.document.addEventListener("click", handleClick);
      return () => {
        window.document.removeEventListener("click", () => click());
        document.removeEventListener("click", handleClick);
      };
    }, []);`);
  });

  it("stays quiet for the recursive window global path", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.window.addEventListener("resize", handleResize);
      return () => {
        window.window.removeEventListener("resize", () => resize());
        window.removeEventListener("resize", handleResize);
      };
    }, []);`);
  });

  it("does not treat distinct fresh targets as aliases", () => {
    expectDiagnosticCount(
      `useEffect(() => {
        const firstTarget = new EventTarget();
        const secondTarget = new EventTarget();
        const handleChange = () => change();
        firstTarget.addEventListener("change", handleChange);
        return () => {
          firstTarget.removeEventListener("change", () => change());
          secondTarget.removeEventListener("change", handleChange);
        };
      }, []);`,
      1,
    );
  });

  it("stays quiet when a guaranteed loop removes before breaking", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize);
      return () => {
        for (const value of [1]) {
          window.removeEventListener("resize", handleResize);
          break;
        }
        window.removeEventListener("resize", () => resize());
      };
    }, []);`);
  });

  it("stays quiet when a guaranteed nested branch removes before breaking", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize);
      return () => {
        for (const value of [1]) {
          if (true) {
            window.removeEventListener("resize", handleResize);
            break;
          }
        }
        window.removeEventListener("resize", () => resize());
      };
    }, []);`);
  });

  it("stays quiet when exhaustive branches contain unknown matching removals", () => {
    expectNoDiagnostics(`useEffect(() => {
      const callbacks = { resize: () => resize() };
      window.addEventListener("resize", callbacks.resize);
      return () => {
        if (isEnabled) {
          window.removeEventListener("resize", callbacks.resize);
        } else {
          window.removeEventListener("resize", callbacks.resize);
        }
        window.removeEventListener("resize", () => resize());
      };
    }, [isEnabled]);`);
  });

  it("stays quiet when exhaustive branches mix known and unknown matching removals", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      const callbacks = { resize: handleResize };
      window.addEventListener("resize", handleResize);
      return () => {
        if (isEnabled) {
          window.removeEventListener("resize", handleResize);
        } else {
          window.removeEventListener("resize", callbacks.resize);
        }
        window.removeEventListener("resize", () => resize());
      };
    }, [isEnabled]);`);
  });

  it("stays quiet for a local non-DOM EventTarget-like implementation", () => {
    expectNoDiagnostics(`class TopicBus {
      listeners = new Map();
      addEventListener(eventName, listener) {
        this.listeners.set(eventName, listener);
      }
      removeEventListener(eventName) {
        this.listeners.delete(eventName);
      }
    }
    const bus = new TopicBus();
    useEffect(() => {
      bus.addEventListener("change", () => change(), true);
      return () => bus.removeEventListener("change", () => change(), false);
    }, []);`);
  });

  it("stays quiet when capture is inherited through an object literal prototype", () => {
    expectNoDiagnostics(`useEffect(() => {
      const handleResize = () => resize();
      window.addEventListener("resize", handleResize, {
        __proto__: { capture: true },
      });
      return () => window.removeEventListener("resize", handleResize, true);
    }, []);`);
  });
});
