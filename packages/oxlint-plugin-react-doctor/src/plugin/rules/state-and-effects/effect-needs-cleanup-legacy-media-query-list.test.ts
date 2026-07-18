import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup legacy MediaQueryList listeners", () => {
  it("accepts the authentic useSyncExternalStore modern and legacy listener cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import React from "react";
export const useMediaQuery = (breakpoint?: string): boolean => {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (!breakpoint || typeof window === "undefined") return () => {};
      const media = window.matchMedia(breakpoint);
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", callback);
        return () => media.removeEventListener("change", callback);
      }
      media.addListener(callback);
      return () => media.removeListener(callback);
    },
    [breakpoint],
  );
  const getSnapshot = React.useCallback(
    () => Boolean(breakpoint && window.matchMedia(breakpoint).matches),
    [breakpoint],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts direct, aliased, and typed MediaQueryList cleanup", () => {
    const sources = [
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const mediaAlias = media;
    const handlerAlias = handle;
    mediaAlias.addListener(handlerAlias);
    return () => mediaAlias.removeListener(handlerAlias);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
declare const media: MediaQueryList;
export const Theme = ({ handle }) => {
  useEffect(() => {
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
declare const win: Window;
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = win.matchMedia("(prefers-color-scheme: dark)");
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const handler = handle as (event: MediaQueryListEvent) => void;
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [handle]);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("accepts stable let, var, and multi-hop listener aliases", () => {
    const sources = [
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    let media = window.matchMedia("(prefers-color-scheme: dark)");
    let listener = handle;
    media.addListener(listener);
    return () => media.removeListener(listener);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    var mediaAlias = media;
    const secondMediaAlias = mediaAlias;
    var listenerAlias = handle;
    const secondListenerAlias = listenerAlias;
    secondMediaAlias.addListener(secondListenerAlias);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
export const Theme = ({ handlers }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const capturedListener = handlers.current;
    media.addListener(capturedListener);
    return () => media.removeListener(capturedListener);
  }, [handlers]);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("rejects mutable MediaQueryList receiver and listener identities", () => {
    const sources = [
      `import { useEffect } from "react";
declare const otherHandle: () => void;
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let listener = handle;
    media.addListener(listener);
    listener = otherHandle;
    return () => media.removeListener(listener);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
declare const otherHandle: () => void;
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addListener(handle);
    handle = otherHandle;
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
declare const otherHandle: () => void;
export const Theme = ({ handlers }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addListener(handlers.current);
    handlers.current = otherHandle;
    return () => media.removeListener(handlers.current);
  }, [handlers]);
  return null;
};`,
      `import { useEffect } from "react";
declare const otherMedia: MediaQueryList;
export const Theme = ({ handle }) => {
  useEffect(() => {
    let media: MediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
    media.addListener(handle);
    media = otherMedia;
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
declare const otherMedia: MediaQueryList;
export const Theme = ({ media, handle }: { media: MediaQueryList; handle: () => void }) => {
  useEffect(() => {
    media.addListener(handle);
    media = otherMedia;
    return () => media.removeListener(handle);
  }, [media, handle]);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    {
      name: "missing cleanup",
      cleanup: "return () => {};",
    },
    {
      name: "different handler",
      cleanup: "return () => media.removeListener(otherHandle);",
    },
    {
      name: "different receiver",
      cleanup: "return () => otherMedia.removeListener(handle);",
    },
    {
      name: "missing cleanup argument",
      cleanup: "return () => media.removeListener();",
    },
    {
      name: "two-argument cleanup",
      cleanup: 'return () => media.removeListener("change", handle);',
    },
  ])("rejects $name", ({ cleanup }) => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Theme = ({ handle, otherHandle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const otherMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addListener(handle);
    ${cleanup}
  }, [handle, otherHandle]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer MediaQueryList semantics from method names alone", () => {
    const sources = [
      `import { useEffect } from "react";
export const CustomListener = ({ customBus }) => {
  useEffect(() => {
    customBus.addListener("change");
    return () => customBus.removeListener("change");
  }, [customBus]);
  return null;
};`,
      `import { useEffect } from "react";
export const ShadowedWindow = ({ handle }) => {
  useEffect(() => {
    const window = { matchMedia: () => createCustomBus() };
    const media = window.matchMedia();
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
export const ShadowedMatchMedia = ({ handle }) => {
  useEffect(() => {
    const matchMedia = () => createCustomBus();
    const media = matchMedia();
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
      `import { useEffect } from "react";
interface MediaQueryList {
  addListener(handler: () => void): void;
  removeListener(handler: () => void): void;
}
declare const media: MediaQueryList;
export const ShadowedMediaQueryList = ({ handle }) => {
  useEffect(() => {
    media.addListener(handle);
    return () => media.removeListener(handle);
  }, [handle]);
  return null;
};`,
    ];
    for (const source of sources) {
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("preserves modern EventTarget listener matching", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useEffect } from "react";
export const Theme = ({ handle }) => {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", handle);
    return () => media.removeEventListener("change", handle);
  }, [handle]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
