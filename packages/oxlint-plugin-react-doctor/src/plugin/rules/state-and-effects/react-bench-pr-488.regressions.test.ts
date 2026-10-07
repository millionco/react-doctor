import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

describe("React Bench PR 488 false-positive regressions", () => {
  it("accepts an epoch reset coupled to aborting an owned async run", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const GeometryOverlay = ({ nodeId, onLocalize, hasDrawable, localizeStatus }) => {
        const [localPhase, setLocalPhase] = useState("idle");
        const prevDepsRef = useRef({ nodeId, onLocalize, hasDrawable, localizeStatus });
        const runAbortRef = useRef(null);
        const generationRef = useRef(0);
        const actionRunActiveRef = useRef(false);
        useEffect(() => {
          const previousDependencies = prevDepsRef.current;
          let isFreshGeneration = false;
          let shouldAbort = false;
          if (previousDependencies.nodeId !== nodeId) {
            isFreshGeneration = true;
            shouldAbort = true;
          }
          if (previousDependencies.onLocalize !== onLocalize) {
            isFreshGeneration = true;
            shouldAbort = true;
          }
          if (previousDependencies.hasDrawable !== hasDrawable) {
            isFreshGeneration = true;
            if (hasDrawable) shouldAbort = true;
          }
          if (previousDependencies.localizeStatus !== localizeStatus) isFreshGeneration = true;
          if (shouldAbort) {
            runAbortRef.current?.abort();
            runAbortRef.current = null;
          }
          if (isFreshGeneration) {
            generationRef.current += 1;
            actionRunActiveRef.current = false;
            setLocalPhase("idle");
          }
          prevDepsRef.current = { nodeId, onLocalize, hasDrawable, localizeStatus };
        }, [nodeId, onLocalize, hasDrawable, localizeStatus]);
        return localPhase;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts request progress cleared only while aborting outstanding requests", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const EvaluationList = ({ searchQuery }) => {
        const [pendingDownloads, setPendingDownloads] = useState({});
        const requestsRef = useRef(new Map());
        const abortAllRequests = () => {
          requestsRef.current.forEach(({ controller }) => controller.abort());
          requestsRef.current.clear();
        };
        useEffect(() => {
          if (!requestsRef.current.size) return;
          abortAllRequests();
          setPendingDownloads({});
        }, [searchQuery]);
        return pendingDownloads;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an epoch increment",
      `const generationRef = useRef(0);
      useEffect(() => {
        generationRef.current += 1;
        setPhase("idle");
      }, [resourceId]);`,
    ],
    [
      "an owned attempt invalidation",
      `const attemptRef = useRef(null);
      useEffect(() => {
        attemptRef.current = null;
        setPhase("idle");
      }, [resourceId]);`,
    ],
    [
      "a request-token reset",
      `const requestTokensRef = useRef(new Map());
      useEffect(() => {
        requestTokensRef.current = new Map();
        setPhase("idle");
      }, [resourceId]);`,
    ],
    [
      "a superseded-attempt marker",
      `const attemptRef = useRef({ superseded: false });
      useEffect(() => {
        attemptRef.current.superseded = true;
        setPhase("idle");
      }, [resourceId]);`,
    ],
  ])("accepts an all-state reset coupled to %s", (_scenario, effectSource) => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const ResourceView = ({ resourceId }) => {
        const [phase, setPhase] = useState("idle");
        ${effectSource}
        return phase;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts cleanup delegated through a memoized helper", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useCallback, useEffect, useRef, useState } from "react";
      const EvaluationList = ({ searchQuery }) => {
        const [pendingDownloads, setPendingDownloads] = useState({});
        const requestsRef = useRef(new Map());
        const abortAllRequests = useCallback(() => {
          requestsRef.current.forEach(({ controller }) => controller.abort());
          requestsRef.current.clear();
        }, []);
        useEffect(() => {
          abortAllRequests();
          setPendingDownloads({});
        }, [searchQuery, abortAllRequests]);
        return pendingDownloads;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a state reset paired with returned resource cleanup", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const ResourceView = ({ resourceId }) => {
        const [phase, setPhase] = useState("idle");
        const controllerRef = useRef(null);
        useEffect(() => {
          setPhase("idle");
          return () => controllerRef.current?.abort();
        }, [resourceId]);
        return phase;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports an ordinary all-state reset on a prop change", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Editor = ({ documentId }) => {
        const [draft, setDraft] = useState("");
        useEffect(() => setDraft(""), [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a reset when a resource-release helper is not invoked", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const Editor = ({ documentId }) => {
        const [draft, setDraft] = useState("");
        const controllerRef = useRef(null);
        const abortRequest = () => controllerRef.current?.abort();
        useEffect(() => {
          void abortRequest;
          setDraft("");
        }, [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports UI state and a non-resource busy flag reset together", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      const Editor = ({ documentId }) => {
        const [phase, setPhase] = useState("idle");
        const busyRef = useRef(false);
        useEffect(() => {
          busyRef.current = false;
          setPhase("idle");
        }, [documentId]);
        return phase;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a reset paired with a plain superseded property write", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Editor = ({ documentId }) => {
        const [draft, setDraft] = useState("");
        const status = { superseded: false };
        useEffect(() => {
          status.superseded = true;
          setDraft("");
        }, [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a reset paired with an unrelated listener cleanup", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Editor = ({ documentId }) => {
        const [draft, setDraft] = useState("");
        useEffect(() => {
          setDraft("");
          const handleResize = () => {};
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("resize", handleResize);
        }, [documentId]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["networkRef", "frameworkRef"])(
    "still reports an ordinary reset paired with %s clearing",
    (refName) => {
      const result = runRule(
        noResetAllStateOnPropChange,
        `import { useEffect, useRef, useState } from "react";
        const Editor = ({ documentId }) => {
          const [draft, setDraft] = useState("");
          const ${refName} = useRef(null);
          useEffect(() => {
            ${refName}.current = null;
            setDraft("");
          }, [documentId]);
          return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
        };`,
        { forceJsx: true },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("accepts state synchronized by a locally owned observer", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      `import { useEffect, useState } from "react";
      const Outline = ({ items }) => {
        const [activeId, setActiveId] = useState("");
        useEffect(() => {
          const observer = new IntersectionObserver((entries) => {
            const activeEntry = entries.find((entry) => entry.isIntersecting);
            if (activeEntry) setActiveId(activeEntry.target.id);
          });
          items.forEach((item) => observer.observe(item));
          return () => observer.disconnect();
        }, [items]);
        return activeId;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts component-scope timer cleanup delegated through a stable helper", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback, useEffect, useRef } from "react";
      const PermissionCard = ({ requestId, timeoutMs, resolved, interactive }) => {
        const timerRef = useRef(null);
        const stopTimer = useCallback(() => {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }, []);
        useEffect(() => {
          if (resolved || !interactive) return;
          timerRef.current = setInterval(() => tick(requestId, timeoutMs), 1000);
          return () => {
            stopTimer();
          };
        }, [requestId, timeoutMs, resolved, interactive, stopTimer]);
        return null;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  const parentSyncRules = [noPassDataToParent, noPassLiveStateToParent, noPropCallbackInEffect];

  it.each(parentSyncRules)("accepts prop-originated data echoed through %s", (rule) => {
    const result = runRule(
      rule,
      `import { useEffect, useRef, useState } from "react";
      const useDeepCompareMemoize = (value) => value;
      const MultiSelectField = ({ values, onPendingChange }) => {
        const [preValues, setPreValues] = useState([]);
        const memoizedValues = useDeepCompareMemoize(values);
        const onPendingChangeRef = useRef(onPendingChange);
        useEffect(() => {
          onPendingChangeRef.current = onPendingChange;
        }, [onPendingChange]);
        useEffect(() => {
          setPreValues(memoizedValues);
          onPendingChangeRef.current?.(memoizedValues);
        }, [memoizedValues]);
        return preValues.length;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([noPassDataToParent, noPropCallbackInEffect])(
    "accepts guarded prop-originated synchronization through %s",
    (rule) => {
      const result = runRule(
        rule,
        `import { useEffect, useRef, useState } from "react";
        const MultiSelectField = ({ values, onPendingChange }) => {
          const [preValues, setPreValues] = useState([]);
          const syncedValuesKeyRef = useRef("");
          useEffect(() => {
            const valuesKey = JSON.stringify(values);
            if (syncedValuesKeyRef.current === valuesKey) return;
            syncedValuesKeyRef.current = valuesKey;
            setPreValues(values);
            onPendingChange?.(values);
          }, [values, onPendingChange]);
          return preValues.length;
        };`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    [
      "a JSON round trip",
      `const valuesKey = JSON.stringify(values);
        useEffect(() => {
          const parsedValues = JSON.parse(valuesKey);
          setPreValues(parsedValues);
          onPendingChange?.(parsedValues);
        }, [valuesKey, onPendingChange]);`,
    ],
    [
      "a useMemo fallback",
      `const resolvedValues = useMemo(() => values ?? [], [values]);
        useEffect(() => {
          setPreValues(resolvedValues);
          onPendingChange?.(resolvedValues);
        }, [resolvedValues, onPendingChange]);`,
    ],
    [
      "an effect-event wrapper",
      `const reportPendingChange = useEffectEvent((nextValues) => {
          onPendingChange?.(nextValues);
        });
        useEffect(() => {
          setPreValues(values);
          reportPendingChange(values);
        }, [values]);`,
    ],
    [
      "a render-time ref stabilizer",
      `const previousValuesRef = useRef(values);
        const areEqual = JSON.stringify(previousValuesRef.current) === JSON.stringify(values);
        const stableValues = areEqual ? previousValuesRef.current : values;
        previousValuesRef.current = stableValues;
        useEffect(() => {
          setPreValues(stableValues);
          onPendingChange?.(stableValues);
        }, [stableValues, onPendingChange]);`,
    ],
  ])("accepts prop-originated data preserved through %s", (_scenario, synchronizationSource) => {
    const result = runRule(
      noPassDataToParent,
      `import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
      const MultiSelectField = ({ values, onPendingChange }) => {
        const [preValues, setPreValues] = useState([]);
        ${synchronizationSource}
        return preValues.length;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts lifecycle notifications with prop and constant payloads", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `import { useEffect, useState } from "react";
      const MultiSelectField = ({ values, onPendingChange, onSearch }) => {
        const [isOpen, setIsOpen] = useState(false);
        const [preValues, setPreValues] = useState([]);
        const [searchValue, setSearchValue] = useState("stale");
        useEffect(() => {
          if (isOpen) {
            setPreValues(values);
            onPendingChange?.(values);
            setSearchValue("");
            onSearch?.("");
          }
        }, [isOpen]);
        return <button onClick={() => setIsOpen(true)}>{preValues.length + searchValue.length}</button>;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports state synchronization when the callback also clears on cleanup", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `import { useEffect, useState } from "react";
      const Editor = ({ onChange }) => {
        const [draft, setDraft] = useState("");
        useEffect(() => {
          onChange(draft);
          return () => onChange(null);
        }, [draft, onChange]);
        return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
      };`,
      { forceJsx: true },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([noPassLiveStateToParent, noPropCallbackInEffect])(
    "still reports child-owned state through %s",
    (rule) => {
      const result = runRule(
        rule,
        `import { useEffect, useState } from "react";
      const MultiSelectField = ({ onPendingChange }) => {
        const [draft, setDraft] = useState([]);
        useEffect(() => {
          onPendingChange?.(draft);
        }, [draft, onPendingChange]);
        return <button onClick={() => setDraft(["local"])}>Change</button>;
      };`,
        { forceJsx: true },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([noPassLiveStateToParent, noPropCallbackInEffect])(
    "still reports state created inside a memoizer-named custom hook through %s",
    (rule) => {
      const result = runRule(
        rule,
        `import { useEffect, useState } from "react";
        const useDeepCompareMemoize = (value) => {
          const [localValue] = useState(value);
          return localValue;
        };
        const MultiSelectField = ({ values, onPendingChange }) => {
          const memoizedValues = useDeepCompareMemoize(values);
          useEffect(() => {
            onPendingChange?.(memoizedValues);
          }, [memoizedValues, onPendingChange]);
          return null;
        };`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still reports child-produced hook data passed to a parent", () => {
    const result = runRule(
      noPassDataToParent,
      `import { useEffect } from "react";
      const MultiSelectField = ({ values, onPendingChange }) => {
        const selectedValues = useSelectedValues(values);
        useEffect(() => {
          onPendingChange?.(selectedValues);
        }, [selectedValues, onPendingChange]);
        return null;
      };`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
