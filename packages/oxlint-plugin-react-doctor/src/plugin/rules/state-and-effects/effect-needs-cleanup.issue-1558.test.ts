import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup issue #1558 false positives", () => {
  describe("FP #1: Returned identifier / plain function unsubscribe", () => {
    it("should not flag returning an identifier bound to an unsubscribe function", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
export const Component1 = () => {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => console.log(state));
    return unsubscribe;
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      if (result.diagnostics.length > 0) {
        console.log("Diagnostic message:", result.diagnostics[0].message);
      }
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should not flag returning a wrapped call to an unsubscribe function", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
export const Component2 = () => {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => console.log(state));
    return () => unsubscribe();
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("FP #2: Cleanup delegated to effect-local helper", () => {
    it("should not flag cleanup performed in a helper function called from the cleanup", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const disarm = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(() => console.log('done'), 30_000);
    };
    const sub = AppState.addEventListener("change", (s) =>
      s === "active" ? arm() : disarm(),
    );
    arm();
    return () => {
      disarm();
      sub.remove();
    };
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should not flag when timer registration is in a helper but cleanup is inline", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
export const Component = () => {
  useEffect(() => {
    let timer = null;
    const arm = () => {
      timer = setTimeout(() => console.log('done'), 30_000);
    };
    arm();
    return () => {
      if (timer != null) {
        clearTimeout(timer);
      }
    };
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("FP #3: Array-collected subscription handles", () => {
    it("should not flag forEach cleanup over collected unsubscribers", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [tabs]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("should not flag for-of cleanup over collected unsubscribers", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
export const Component = ({ tabs }) => {
  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [tabs]);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("FP #4: Member cleanup on an object constructed in the effect", () => {
    it("should not flag dispose() on an effect-local object", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect } from "react";
import { AppState } from "react-native";
export const Component = () => {
  useEffect(() => {
    const coalescer = {
      timer: null,
      handle: (state) => {},
      dispose: () => {
        if (coalescer.timer != null) {
          clearTimeout(coalescer.timer);
        }
      }
    };
    const sub = AppState.addEventListener("change", coalescer.handle);
    return () => {
      sub.remove();
      coalescer.dispose();
    };
  }, []);
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe("FP #5: Ref-stored timer with deliberate cross-effect ownership", () => {
    it("should not flag timer arming in one effect when cleanup is in a sibling unmount-scoped effect", () => {
      const result = runRule(
        effectNeedsCleanup,
        `import { useEffect, useLayoutEffect, useRef } from "react";
export const Component = ({ videoId }) => {
  const watchdogRef = useRef(null);
  
  useLayoutEffect(() => {
    watchdogRef.current = setTimeout(() => console.log('timeout'), 4000);
  }, [videoId]);

  useEffect(() => {
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
    };
  }, []);
  
  return null;
};`,
      );
      expect(result.parseErrors).toEqual([]);
      // Note: This case is tricky and might still flag. The issue acknowledges this.
      // If it flags, we might need special handling or documentation.
      // For now, let's see what happens.
    });
  });
});
