import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectListenerCleanupMismatch } from "./effect-listener-cleanup-mismatch.js";

interface ListenerRuleTestCase {
  code: string;
  expectedCount: number;
  name: string;
  reactImport?: string;
}

const DEFAULT_REACT_IMPORT =
  'import { useEffect, useInsertionEffect, useLayoutEffect, useRef } from "react";';

const runListenerRule = (code: string, reactImport = DEFAULT_REACT_IMPORT) =>
  runRule(effectListenerCleanupMismatch, `${reactImport}\n${code}`);

const expectDiagnosticCount = (
  code: string,
  expectedCount: number,
  reactImport = DEFAULT_REACT_IMPORT,
): void => {
  const result = runListenerRule(code, reactImport);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("effect-listener-cleanup-mismatch", () => {
  const reactApiCallCases: ListenerRuleTestCase[] = [
    {
      name: "renamed useInsertionEffect imports",
      reactImport: 'import { useInsertionEffect as useListenerInsertionEffect } from "react";',
      code: `useListenerInsertionEffect(() => {
        window.addEventListener("resize", () => resize());
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "default React effect receivers",
      reactImport: 'import ReactClient from "react";',
      code: `ReactClient.useEffect(() => {
        window.addEventListener("resize", () => resize());
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "namespace React effect receivers",
      reactImport: 'import * as ReactClient from "react";',
      code: `ReactClient.useLayoutEffect(() => {
        window.addEventListener("resize", () => resize());
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "shadowed useInsertionEffect imports",
      code: `const run = () => {
        const useInsertionEffect = (callback) => callback();
        useInsertionEffect(() => {
          window.addEventListener("resize", () => resize());
          return () => window.removeEventListener("resize", () => resize());
        }, []);
      };`,
      expectedCount: 0,
    },
    {
      name: "unbound useInsertionEffect calls",
      reactImport: "",
      code: `useInsertionEffect(() => {
        window.addEventListener("resize", () => resize());
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of reactApiCallCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount, testCase.reactImport);
    });
  }

  it("reports handlers re-declared inside cleanup", () => {
    const result = runListenerRule(`
      const CoreUiShape = () => {
        useEffect(() => {
          const handleMouseUp = () => finishResize();
          window.addEventListener("mouseup", handleMouseUp);
          return () => {
            const handleMouseUp = () => finishResize();
            window.removeEventListener("mouseup", handleMouseUp);
          };
        }, []);
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("different callback binding");
  });

  it("reports same-name function declarations re-declared inside cleanup", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          function handleMouseMove() {
            continueResize();
          }
          window.addEventListener("mousemove", handleMouseMove);
          return () => {
            function handleMouseMove() {
              continueResize();
            }
            window.removeEventListener("mousemove", handleMouseMove);
          };
        }, []);
      `,
      1,
    );
  });

  it("reports the CoreUI ref.current cleanup mismatch", () => {
    const result = runListenerRule(`
      const Carousel = () => {
        const carouselItemRef = useRef<HTMLDivElement>(null);
        useEffect(() => {
          const handleTouchStart = () => beginSwipe();
          (carouselItemRef.current as HTMLDivElement)?.addEventListener(
            "touchstart",
            handleTouchStart,
            true,
          );
          return () => {
            const handleTouchStart = () => beginSwipe();
            carouselItemRef.current?.removeEventListener("touchstart", handleTouchStart);
          };
        }, []);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("different callback binding");
    expect(result.diagnostics[0].message).toContain("capture false");
    expect(result.diagnostics[0].message).toContain("capture true");
  });

  it("reports capture true removed with omitted capture", () => {
    const result = runListenerRule(`
      useEffect(() => {
        const handleClick = () => close();
        document.addEventListener("click", handleClick, true);
        return () => document.removeEventListener("click", handleClick);
      }, []);
    `);

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("capture");
    expect(result.diagnostics[0].message).toContain("true");
    expect(result.diagnostics[0].message).toContain("false");
  });

  it("accepts equivalent true and capture true options", () => {
    expectDiagnosticCount(
      `
        useLayoutEffect(() => {
          const handleFocus = () => focus();
          window.addEventListener("focus", handleFocus, true);
          return () => window.removeEventListener("focus", handleFocus, { capture: true });
        }, []);
      `,
      0,
    );
  });

  it("accepts omitted, false, and capture false as equivalent", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const first = () => firstAction();
          const second = () => secondAction();
          window.addEventListener("first", first);
          window.addEventListener("second", second, { capture: false });
          return () => {
            window.removeEventListener("first", first, false);
            window.removeEventListener("second", second);
          };
        }, []);
      `,
      0,
    );
  });

  it("reports a useInsertionEffect callback mismatch", () => {
    expectDiagnosticCount(
      `
        useInsertionEffect(() => {
          window.addEventListener("resize", () => resize());
          return () => window.removeEventListener("resize", () => resize());
        }, []);
      `,
      1,
    );
  });

  it("accepts a valid useInsertionEffect cleanup", () => {
    expectDiagnosticCount(
      `
        useInsertionEffect(() => {
          const handleResize = () => resize();
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("resize", handleResize);
        }, []);
      `,
      0,
    );
  });

  it("accepts an immutable callback alias chain", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          const listener = handleResize;
          const cleanupListener = listener;
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("resize", cleanupListener);
        }, []);
      `,
      0,
    );
  });

  it("distinguishes same-name shadowed callback bindings", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const listener = () => start();
          window.addEventListener("resize", listener);
          return () => {
            const listener = () => stop();
            window.removeEventListener("resize", listener);
          };
        }, []);
      `,
      1,
    );
  });

  it("reports fresh inline functions", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          window.addEventListener("resize", () => resize());
          return () => window.removeEventListener("resize", () => resize());
        }, []);
      `,
      1,
    );
  });

  const staticEventNameCases: ListenerRuleTestCase[] = [
    {
      name: "direct const event names",
      code: `useEffect(() => {
        const eventName = "resize";
        window.addEventListener(eventName, () => resize());
        return () => window.removeEventListener(eventName, () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "const alias event names",
      code: `useEffect(() => {
        const sourceEventName = "resize";
        const eventName = sourceEventName;
        window.addEventListener(eventName, () => resize());
        return () => window.removeEventListener(sourceEventName, () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "static template event names",
      code: `useEffect(() => {
        window.addEventListener(\`resize\`, () => resize());
        return () => window.removeEventListener(\`resize\`, () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "destructured-default event names",
      code: `useEffect(() => {
        const { eventName = "resize" } = options;
        window.addEventListener(eventName, () => resize());
        return () => window.removeEventListener(eventName, () => resize());
      }, [options]);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of staticEventNameCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const staticOptionKeyCases: ListenerRuleTestCase[] = [
    {
      name: "quoted capture keys",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize, { "capture": true });
        return () => window.removeEventListener("resize", handleResize);
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "computed string capture keys",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize, { ["capture"]: true });
        return () => window.removeEventListener("resize", handleResize);
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "dynamic computed capture keys",
      code: `useEffect(() => {
        const added = () => addedAction();
        const removed = () => removedAction();
        window.addEventListener("resize", added, { [captureKey]: true });
        return () => window.removeEventListener("resize", removed);
      }, [captureKey]);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of staticOptionKeyCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  it("ignores passive and once differences", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleWheel = () => wheel();
          window.addEventListener("wheel", handleWheel, { passive: true, once: true });
          return () => window.removeEventListener("wheel", handleWheel, {
            passive: false,
            once: false,
          });
        }, []);
      `,
      0,
    );
  });

  it("stays quiet for dynamic and spread capture options", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const added = () => addedAction();
          const removed = () => removedAction();
          window.addEventListener("click", added, options);
          window.addEventListener("keydown", added, { ...options, capture: true });
          return () => {
            window.removeEventListener("click", removed);
            window.removeEventListener("keydown", removed, true);
          };
        }, [options]);
      `,
      0,
    );
  });

  it("stays quiet when the same local AbortController is aborted", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const controller = new AbortController();
          window.addEventListener("resize", () => resize(), { signal: controller.signal });
          return () => {
            window.removeEventListener("resize", () => resize());
            controller.abort();
          };
        }, []);
      `,
      0,
    );
  });

  it("reports a direct local signal when its controller is not aborted", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const controller = new AbortController();
          window.addEventListener("resize", () => resize(), { signal: controller.signal });
          return () => window.removeEventListener("resize", () => resize());
        }, []);
      `,
      1,
    );
  });

  const unhandledSignalBindingCases: ListenerRuleTestCase[] = [
    {
      name: "a direct signal alias",
      code: `useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;
        window.addEventListener("resize", () => resize(), { signal });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "a destructured signal alias",
      code: `useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        window.addEventListener("resize", () => resize(), { signal });
        return () => window.removeEventListener("resize", () => resize());
      }, []);`,
      expectedCount: 1,
    },
  ];

  for (const testCase of unhandledSignalBindingCases) {
    it(`reports an unhandled listener using ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const abortControllerAliasCases: ListenerRuleTestCase[] = [
    {
      name: "signal and abort aliases",
      code: `useEffect(() => {
        const controller = new AbortController();
        const signalController = controller;
        const cleanupController = signalController;
        window.addEventListener("resize", () => resize(), {
          signal: signalController.signal,
        });
        return () => {
          window.removeEventListener("resize", () => resize());
          cleanupController.abort();
        };
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "computed signal option keys through an alias",
      code: `useEffect(() => {
        const controller = new AbortController();
        const controllerAlias = controller;
        window.addEventListener("resize", () => resize(), {
          ["signal"]: controllerAlias.signal,
        });
        return () => {
          window.removeEventListener("resize", () => resize());
          controller.abort();
        };
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "a direct signal binding",
      code: `useEffect(() => {
        const controller = new AbortController();
        const signal = controller.signal;
        window.addEventListener("resize", () => resize(), { signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          controller.abort();
        };
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "a destructured signal binding",
      code: `useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        window.addEventListener("resize", () => resize(), { signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          controller.abort();
        };
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "an unresolved signal binding",
      code: `useEffect(() => {
        window.addEventListener("resize", () => resize(), { signal: externalSignal });
        return () => window.removeEventListener("resize", () => resize());
      }, [externalSignal]);`,
      expectedCount: 0,
    },
    {
      name: "a signal from a destructured-default controller",
      code: `useEffect(() => {
        const { controller = new AbortController() } = options;
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => window.removeEventListener("resize", () => resize());
      }, [options]);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of abortControllerAliasCases) {
    it(`handles ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const pathAmbiguousCleanupCases: ListenerRuleTestCase[] = [
    {
      name: "a conditional AbortController abort",
      code: `useEffect(() => {
        const controller = new AbortController();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          if (shouldAbort) controller.abort();
        };
      }, [shouldAbort]);`,
      expectedCount: 1,
    },
    {
      name: "an unreachable AbortController abort",
      code: `useEffect(() => {
        const controller = new AbortController();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => {
          window.removeEventListener("resize", () => resize());
          if (false) controller.abort();
        };
      }, []);`,
      expectedCount: 1,
    },
    {
      name: "a conditional valid removal beside an unconditional mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          if (shouldRemoveCorrectly) {
            window.removeEventListener("resize", handleResize);
          }
        };
      }, [shouldRemoveCorrectly]);`,
      expectedCount: 1,
    },
  ];

  for (const testCase of pathAmbiguousCleanupCases) {
    it(`reports despite ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const concisePathAmbiguousCleanupCases: ListenerRuleTestCase[] = [
    {
      name: "a concise ternary choosing valid or wrong removal",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => shouldRemoveCorrectly
          ? window.removeEventListener("resize", handleResize)
          : window.removeEventListener("resize", () => resize());
      }, [shouldRemoveCorrectly]);`,
      expectedCount: 0,
    },
    {
      name: "a concise short-circuit conditional abort",
      code: `useEffect(() => {
        const controller = new AbortController();
        window.addEventListener("resize", () => resize(), { signal: controller.signal });
        return () => shouldAbort && controller.abort();
      }, [shouldAbort]);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of concisePathAmbiguousCleanupCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const earlyExitCleanupCases: ListenerRuleTestCase[] = [
    {
      name: "an early return before a mismatched removal",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          if (shouldReturnEarly) return;
          window.removeEventListener("resize", () => resize());
        };
      }, [shouldReturnEarly]);`,
      expectedCount: 0,
    },
    {
      name: "a conditional throw before a mismatched removal",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          if (shouldThrow) throw new Error("cleanup failed");
          window.removeEventListener("resize", () => resize());
        };
      }, [shouldThrow]);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of earlyExitCleanupCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  it("ignores early exits inside nested cleanup functions", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          window.addEventListener("resize", handleResize);
          return () => {
            const nested = () => {
              if (shouldReturnEarly) return;
              throw new Error("nested failure");
            };
            consume(nested);
            window.removeEventListener("resize", () => resize());
          };
        }, [shouldReturnEarly]);
      `,
      1,
    );
  });

  it("does not let a different AbortController suppress the mismatch", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const registrationController = new AbortController();
          const cleanupController = new AbortController();
          window.addEventListener("resize", () => resize(), {
            signal: registrationController.signal,
          });
          return () => {
            window.removeEventListener("resize", () => resize());
            cleanupController.abort();
          };
        }, []);
      `,
      1,
    );
  });

  it("lets a valid matching removal win over an extra invalid removal", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          window.addEventListener("resize", handleResize);
          return () => {
            window.removeEventListener("resize", () => resize());
            window.removeEventListener("resize", handleResize);
          };
        }, []);
      `,
      0,
    );
  });

  const unknownRemovalCases: ListenerRuleTestCase[] = [
    {
      name: "an unknown callback beside a provable mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          window.removeEventListener("resize", callbacks[currentIndex]);
        };
      }, [callbacks, currentIndex]);`,
      expectedCount: 0,
    },
    {
      name: "unknown capture options beside a provable mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize, true);
        return () => {
          window.removeEventListener("resize", handleResize);
          window.removeEventListener("resize", handleResize, removalOptions);
        };
      }, [removalOptions]);`,
      expectedCount: 0,
    },
    {
      name: "an unknown event beside a provable mismatch",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        return () => {
          window.removeEventListener("resize", () => resize());
          window.removeEventListener(cleanupEventName, handleResize);
        };
      }, [cleanupEventName]);`,
      expectedCount: 0,
    },
    {
      name: "an unknown abort receiver beside a provable mismatch",
      code: `const useListener = (cleanupController) => {
        useEffect(() => {
          const controller = new AbortController();
          window.addEventListener("resize", () => resize(), { signal: controller.signal });
          return () => {
            window.removeEventListener("resize", () => resize());
            cleanupController.abort();
          };
        }, [cleanupController]);
      };`,
      expectedCount: 0,
    },
  ];

  for (const testCase of unknownRemovalCases) {
    it(`suppresses for ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const ambiguousCleanupCases: ListenerRuleTestCase[] = [
    {
      name: "conditional valid and invalid cleanup alternatives",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        if (useAlternateCleanup) {
          return () => window.removeEventListener("resize", () => resize());
        }
        return () => window.removeEventListener("resize", handleResize);
      }, [useAlternateCleanup]);`,
      expectedCount: 0,
    },
    {
      name: "multiple invalid cleanup alternatives",
      code: `useEffect(() => {
        const handleResize = () => resize();
        window.addEventListener("resize", handleResize);
        if (useAlternateCleanup) {
          return () => window.removeEventListener("resize", () => firstResize());
        }
        return () => window.removeEventListener("resize", () => secondResize());
      }, [useAlternateCleanup]);`,
      expectedCount: 0,
    },
    {
      name: "a resolved and unknown cleanup alternative",
      code: `const useListener = (providedCleanup) => {
        useEffect(() => {
          const handleResize = () => resize();
          window.addEventListener("resize", handleResize);
          if (useProvidedCleanup) return providedCleanup;
          return () => window.removeEventListener("resize", () => resize());
        }, [providedCleanup, useProvidedCleanup]);
      };`,
      expectedCount: 0,
    },
  ];

  for (const testCase of ambiguousCleanupCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  const duplicateRegistrationCases: ListenerRuleTestCase[] = [
    {
      name: "one valid removal for two same-event registrations",
      code: `useEffect(() => {
        const firstListener = () => firstResize();
        const secondListener = () => secondResize();
        window.addEventListener("resize", firstListener);
        window.addEventListener("resize", secondListener);
        return () => window.removeEventListener("resize", secondListener);
      }, []);`,
      expectedCount: 0,
    },
    {
      name: "an invalid removal for two same-event registrations",
      code: `useEffect(() => {
        const firstListener = () => firstResize();
        const secondListener = () => secondResize();
        window.addEventListener("resize", firstListener);
        window.addEventListener("resize", secondListener);
        return () => window.removeEventListener("resize", () => cleanupResize());
      }, []);`,
      expectedCount: 0,
    },
  ];

  for (const testCase of duplicateRegistrationCases) {
    it(`stays quiet for ${testCase.name}`, () => {
      expectDiagnosticCount(testCase.code, testCase.expectedCount);
    });
  }

  it("pairs multiple registrations independently", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          const handleScroll = () => scroll();
          window.addEventListener("resize", handleResize);
          window.addEventListener("scroll", handleScroll, true);
          return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("scroll", handleScroll);
          };
        }, []);
      `,
      1,
    );
  });

  it("stays quiet for a different target", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          firstTarget.addEventListener("resize", handleResize);
          return () => secondTarget.removeEventListener("resize", () => resize());
        }, []);
      `,
      0,
    );
  });

  it("stays quiet for different member target roots and properties", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          firstRef.current.addEventListener("resize", handleResize);
          return () => {
            secondRef.current.removeEventListener("resize", () => resize());
            firstRef.previous.removeEventListener("resize", () => resize());
          };
        }, []);
      `,
      0,
    );
  });

  it("stays quiet for dynamic computed targets", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          targetRef[propertyName].addEventListener("resize", handleResize);
          return () => targetRef[propertyName].removeEventListener("resize", () => resize());
        }, [propertyName]);
      `,
      0,
    );
  });

  it("stays quiet for a different event", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("scroll", () => resize());
        }, []);
      `,
      0,
    );
  });

  it("does not treat a nested setup function as cleanup", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          window.addEventListener("resize", () => resize());
          const unrelated = () => {
            window.removeEventListener("resize", () => resize());
          };
          schedule(unrelated);
          return () => cancel();
        }, []);
      `,
      0,
    );
  });

  it("does not treat a nested cleanup callback removal as direct cleanup", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          window.addEventListener("resize", () => resize());
          return () => {
            queueMicrotask(() => {
              window.removeEventListener("resize", () => resize());
            });
          };
        }, []);
      `,
      0,
    );
  });

  it("supports a returned immutable cleanup binding", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const added = () => addedAction();
          const removed = () => removedAction();
          window.addEventListener("resize", added);
          const cleanup = () => window.removeEventListener("resize", removed);
          return cleanup;
        }, []);
      `,
      1,
    );
  });

  it("stays quiet for dynamic callback expressions", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          window.addEventListener("resize", callbacks[currentIndex]);
          return () => window.removeEventListener("resize", callbacks[nextIndex]);
        }, []);
      `,
      0,
    );
  });

  it("stays quiet for dynamic events", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          window.addEventListener(events[currentIndex], () => start());
          return () => window.removeEventListener(events[currentIndex], () => stop());
        }, []);
      `,
      0,
    );
  });

  it("accepts matching callback and capture on the same ref.current chain", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          const handleResize = () => resize();
          targetRef.current?.addEventListener("resize", handleResize, { capture: true });
          return () => {
            (targetRef.current as HTMLElement)?.removeEventListener(
              "resize",
              handleResize,
              true,
            );
          };
        }, []);
      `,
      0,
    );
  });

  it("does not report EventEmitter on and off calls", () => {
    expectDiagnosticCount(
      `
        useEffect(() => {
          emitter.on("change", () => start());
          return () => emitter.off("change", () => stop());
        }, []);
      `,
      0,
    );
  });
});
