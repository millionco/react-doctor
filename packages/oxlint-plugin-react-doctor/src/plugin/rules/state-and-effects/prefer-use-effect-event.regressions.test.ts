import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

const runPreferUseEffectEvent = (code: string) => runRule(preferUseEffectEvent, code);

describe("prefer-use-effect-event — callback stability regressions", () => {
  it("stays silent when the Lobe typewriter helper is both scheduled and called synchronously", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const TypewriterEffect = ({ delay, onSentenceComplete }) => {
        useEffect(() => {
          const executeTypingAnimation = () => onSentenceComplete("done");
          if (delay > 0) {
            setTimeout(executeTypingAnimation, delay);
          } else {
            executeTypingAnimation();
          }
        }, [delay, onSentenceComplete]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps reporting when every execution of a local helper is scheduled", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const TypewriterEffect = ({ delay, onSentenceComplete }) => {
        useEffect(() => {
          const executeTypingAnimation = () => onSentenceComplete("done");
          const timeoutId = setTimeout(executeTypingAnimation, delay);
          return () => clearTimeout(timeoutId);
        }, [delay, onSentenceComplete]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting a deferred function declaration nested in a block", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, onSearch }) => {
        useEffect(() => {
          if (delay > 0) {
            const timeoutId = setTimeout(searchLater, delay);
            function searchLater() {
              onSearch("done");
            }
            return () => clearTimeout(timeoutId);
          }
        }, [delay, onSearch]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves deferred declarations nested in loop, switch, and try blocks", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, mode, onForSearch, onSwitchSearch, onTrySearch }) => {
        useEffect(() => {
          for (const timeoutDelay of [delay]) {
            setTimeout(searchAfterLoop, timeoutDelay);
            function searchAfterLoop() {
              onForSearch("done");
            }
          }
        }, [delay, onForSearch]);

        useEffect(() => {
          switch (mode) {
            case "deferred": {
              setTimeout(searchAfterSwitch, delay);
              function searchAfterSwitch() {
                onSwitchSearch("done");
              }
              break;
            }
          }
        }, [mode, onSwitchSearch]);

        useEffect(() => {
          try {
            setTimeout(searchAfterTry, delay);
            function searchAfterTry() {
              onTrySearch("done");
            }
          } catch {}
        }, [delay, onTrySearch]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves a wrapped deferred declaration without confusing shadowed reads", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, onSearch }) => {
        useEffect(() => {
          if (delay > 0) {
            setTimeout((searchLater as (() => void))!, delay);
            ["shadow"].forEach((searchLater) => searchLater.toUpperCase());
            function searchLater() {
              onSearch("done");
            }
          }
        }, [delay, onSearch]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting a nested declaration used only by a paired subscription", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onKey }) => {
        useEffect(() => {
          if (active) {
            window.addEventListener("keydown", handleKey);
            function handleKey(event) {
              onKey(event.key);
            }
            return () => window.removeEventListener("keydown", handleKey);
          }
        }, [active, onKey]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for nested declarations with mixed direct and deferred calls", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, onSearch }) => {
        useEffect(() => {
          if (delay > 0) {
            setTimeout(searchLater, delay);
            if (delay === 1) searchLater();
            function searchLater() {
              onSearch("done");
            }
          }
        }, [delay, onSearch]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a nested declaration is aliased, reassigned, stored, escaped, or never called", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, mode, onAliased, onReassigned, onStored, onEscaped, onUnused }) => {
        useEffect(() => {
          if (delay > 0) {
            const searchNow = searchLater;
            setTimeout(searchLater, delay);
            searchNow();
            function searchLater() {
              onAliased("done");
            }
          }
        }, [delay, onAliased]);

        useEffect(() => {
          if (delay > 0) {
            setTimeout(searchLater, delay);
            searchLater = fallbackSearch;
            function searchLater() {
              onReassigned("done");
            }
          }
        }, [delay, onReassigned]);

        useEffect(() => {
          if (delay > 0) {
            setTimeout(searchLater, delay);
            const callbacks = { searchLater };
            consume(callbacks);
            function searchLater() {
              onStored("done");
            }
          }
        }, [delay, onStored]);

        useEffect(() => {
          if (delay > 0) {
            setTimeout(searchLater, delay);
            consume(searchLater);
            function searchLater() {
              onEscaped("done");
            }
          }
        }, [delay, onEscaped]);

        useEffect(() => {
          if (mode === "unused") {
            function searchLater() {
              onUnused("done");
            }
          }
        }, [mode, onUnused]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a nested declaration is passed to an ordinary callback API", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const SearchInput = ({ delay, onSearch }) => {
        useEffect(() => {
          if (delay > 0) {
            [delay].forEach(searchLater);
            function searchLater() {
              onSearch("done");
            }
          }
        }, [delay, onSearch]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a local helper only runs synchronously", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const TypewriterEffect = ({ delay, onSentenceComplete }) => {
        useEffect(() => {
          const executeTypingAnimation = () => onSentenceComplete("done");
          if (delay === 0) executeTypingAnimation();
        }, [delay, onSentenceComplete]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when direct calls surround a scheduled helper reference", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const TypewriterEffect = ({ delay, onSentenceComplete }) => {
        useEffect(() => {
          const executeTypingAnimation = () => onSentenceComplete("done");
          if (delay < 0) executeTypingAnimation();
          setTimeout(executeTypingAnimation, delay);
          if (delay === 0) executeTypingAnimation();
        }, [delay, onSentenceComplete]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when cleanup directly invokes the scheduled helper", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          setTimeout(close, 100);
          return () => close();
        }, [active, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a scheduled helper escapes through direct-call aliases", () => {
    const oneHopResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          const closeNow = close;
          setTimeout(close, 100);
          closeNow();
        }, [active, onClose]);
        return null;
      };
    `);
    const multiHopResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          const closeAlias = close;
          const closeNow = closeAlias;
          setTimeout(close, 100);
          closeNow();
        }, [active, onClose]);
        return null;
      };
    `);

    expect(oneHopResult.parseErrors).toEqual([]);
    expect(oneHopResult.diagnostics).toEqual([]);
    expect(multiHopResult.parseErrors).toEqual([]);
    expect(multiHopResult.diagnostics).toEqual([]);
  });

  it("keeps reporting a timer-only recursive helper", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Poller = ({ active, onPoll }) => {
        useEffect(() => {
          function poll(remaining) {
            onPoll();
            if (remaining > 0) poll(remaining - 1);
          }
          const timeoutId = setTimeout(poll, 100, 2);
          return () => clearTimeout(timeoutId);
        }, [active, onPoll]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps reporting subscription-only helpers with cleanup identity reads", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onKey }) => {
        useEffect(() => {
          const handleKey = (event) => onKey(event.key);
          window.addEventListener("keydown", handleKey);
          return () => window.removeEventListener("keydown", handleKey);
        }, [active, onKey]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative for callback-shaped arguments to unrelated release methods", () => {
    const abortResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          setTimeout(close, 100);
          controller.abort(close);
        }, [active, onClose]);
        return null;
      };
    `);
    const closeResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          setTimeout(close, 100);
          socket.close(close);
        }, [active, onClose]);
        return null;
      };
    `);

    expect(abortResult.parseErrors).toEqual([]);
    expect(abortResult.diagnostics).toEqual([]);
    expect(closeResult.parseErrors).toEqual([]);
    expect(closeResult.diagnostics).toEqual([]);
  });

  it("stays conservative for mismatched callback removal identities", () => {
    const receiverResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onKey }) => {
        useEffect(() => {
          const handleKey = (event) => onKey(event.key);
          firstTarget.addEventListener("keydown", handleKey);
          return () => secondTarget.removeEventListener("keydown", handleKey);
        }, [active, onKey]);
        return null;
      };
    `);
    const eventResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onKey }) => {
        useEffect(() => {
          const handleKey = (event) => onKey(event.key);
          window.addEventListener("keydown", handleKey);
          return () => window.removeEventListener("keyup", handleKey);
        }, [active, onKey]);
        return null;
      };
    `);
    const computedMethodResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onKey, removeMethod }) => {
        useEffect(() => {
          const handleKey = (event) => onKey(event.key);
          window.addEventListener("keydown", handleKey);
          return () => window[removeMethod]("keydown", handleKey);
        }, [active, onKey]);
        return null;
      };
    `);

    expect(receiverResult.parseErrors).toEqual([]);
    expect(receiverResult.diagnostics).toEqual([]);
    expect(eventResult.parseErrors).toEqual([]);
    expect(eventResult.diagnostics).toEqual([]);
    expect(computedMethodResult.parseErrors).toEqual([]);
    expect(computedMethodResult.diagnostics).toEqual([]);
  });

  it("stays conservative when a scheduled helper is returned or stored", () => {
    const returnedResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          setTimeout(close, 100);
          return close;
        }, [active, onClose]);
        return null;
      };
    `);
    const storedResult = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          setTimeout(close, 100);
          const cleanup = { close };
          return () => cleanup.close();
        }, [active, onClose]);
        return null;
      };
    `);

    expect(returnedResult.parseErrors).toEqual([]);
    expect(returnedResult.diagnostics).toEqual([]);
    expect(storedResult.parseErrors).toEqual([]);
    expect(storedResult.diagnostics).toEqual([]);
  });

  it("does not correlate a direct helper with a shadowed scheduled binding", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = () => onClose();
          {
            const close = () => log("shadow");
            setTimeout(close, 100);
          }
          close();
        }, [active, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count a shadowed callback parameter as a dependency read", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Listener = ({ active, onClose }) => {
        useEffect(() => {
          const close = (onClose) => onClose();
          setTimeout(close, 100, fallbackClose);
        }, [active, onClose]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the authentic empty-dependency useCallback false positive", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useRef, useState } from "react";

      export const NotificationControl = ({ open }) => {
        const [, setIsOpen] = useState(open);
        const triggerRef = useRef(null);
        const closeAndFocusTrigger = useCallback(() => {
          setIsOpen(false);
          triggerRef.current?.focus();
        }, []);

        useEffect(() => {
          if (!open) return;
          const handleKeyDown = (event) => {
            if (event.key === "Escape") closeAndFocusTrigger();
          };
          document.addEventListener("keydown", handleKeyDown);
          return () => document.removeEventListener("keydown", handleKeyDown);
        }, [closeAndFocusTrigger, open]);

        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a React useCallback whose nonempty dependencies can change", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Search = ({ query, open }) => {
        const runSearch = useCallback(() => search(query), [query]);
        useEffect(() => {
          const timeoutId = setTimeout(() => runSearch(), 100);
          return () => clearTimeout(timeoutId);
        }, [runSearch, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a React useCallback depends only on a state setter", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useState } from "react";

      const Composer = ({ open }) => {
        const [, setComposeOpen] = useState(false);
        const openComposer = useCallback(() => setComposeOpen(true), [setComposeOpen]);
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves multi-hop aliases of stable React hook values", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useReducer } from "react";

      const Composer = ({ open }) => {
        const [, dispatch] = useReducer(reducer, initialState);
        const dispatchAlias = dispatch;
        const stableDispatch = dispatchAlias;
        const openComposer = useCallback(
          () => stableDispatch({ type: "open" }),
          [stableDispatch],
        );
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when a React useCallback depends on changing state", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useState } from "react";

      const Composer = ({ open }) => {
        const [composeOpen] = useState(false);
        const openComposer = useCallback(() => work(composeOpen), [composeOpen]);
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a similarly named userland useState return", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Composer = ({ open }) => {
        const useState = () => [false, makeChangingCallback()];
        const [, setComposeOpen] = useState();
        const openComposer = useCallback(() => setComposeOpen(true), [setComposeOpen]);
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a React useCallback with a dynamic dependency list", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Search = ({ dependencies, open }) => {
        const runSearch = useCallback(() => search(), dependencies);
        useEffect(() => {
          const timeoutId = setTimeout(() => runSearch(), 100);
          return () => clearTimeout(timeoutId);
        }, [runSearch, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a React useCallback with an omitted dependency list", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Search = ({ open }) => {
        const runSearch = useCallback(() => search());
        useEffect(() => {
          const timeoutId = setTimeout(() => runSearch(), 100);
          return () => clearTimeout(timeoutId);
        }, [runSearch, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves renamed React useCallback imports", () => {
    const stableResult = runPreferUseEffectEvent(`
      import { useCallback as useStableCallback, useEffect } from "react";

      const Stable = ({ open }) => {
        const handle = useStableCallback(() => work(), []);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);
    const changingResult = runPreferUseEffectEvent(`
      import { useCallback as useStableCallback, useEffect } from "react";

      const Changing = ({ open, value }) => {
        const handle = useStableCallback(() => work(value), [value]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(stableResult.parseErrors).toEqual([]);
    expect(stableResult.diagnostics).toEqual([]);
    expect(changingResult.parseErrors).toEqual([]);
    expect(changingResult.diagnostics).toHaveLength(1);
  });

  it("resolves React namespace useCallback calls", () => {
    const stableResult = runPreferUseEffectEvent(`
      import * as React from "react";

      const Stable = ({ open }) => {
        const handle = React.useCallback(() => work(), []);
        React.useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);
    const changingResult = runPreferUseEffectEvent(`
      import React from "react";

      const Changing = ({ open, value }) => {
        const handle = React.useCallback(() => work(value), [value]);
        React.useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(stableResult.parseErrors).toEqual([]);
    expect(stableResult.diagnostics).toEqual([]);
    expect(changingResult.parseErrors).toEqual([]);
    expect(changingResult.diagnostics).toHaveLength(1);
  });

  it("stays silent for a locally shadowed useCallback function", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Search = ({ open, value }) => {
        const useCallback = (callback, dependencies) => callback;
        const handle = useCallback(() => work(value), [value]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for useCallback imported from a non-React package", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";
      import { useCallback } from "callback-library";

      const Search = ({ open, value }) => {
        const handle = useCallback(() => work(value), [value]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a non-React namespace useCallback method", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";
      import * as CallbackLibrary from "callback-library";

      const Search = ({ open, value }) => {
        const handle = CallbackLibrary.useCallback(() => work(value), [value]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("unwraps TypeScript syntax around an empty dependency array", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Search = ({ open }) => {
        const handle = useCallback(() => work(), [] as const);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a destructured callback prop positive", () => {
    const result = runPreferUseEffectEvent(`
      import { useEffect } from "react";

      const Search = ({ onSearch, query }) => {
        useEffect(() => {
          const timeoutId = setTimeout(() => onSearch(query), 100);
          return () => clearTimeout(timeoutId);
        }, [onSearch, query]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a changing callback behind a local alias because aliases are never collected", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect } from "react";

      const Search = ({ open, value }) => {
        const changingHandle = useCallback(() => work(value), [value]);
        const handleAlias = changingHandle;
        useEffect(() => {
          const timeoutId = setTimeout(() => handleAlias(), 100);
          return () => clearTimeout(timeoutId);
        }, [handleAlias, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves useCallback destructured from the React namespace", () => {
    const changingResult = runPreferUseEffectEvent(`
      import * as React from "react";

      const { useCallback, useEffect } = React;

      const Search = ({ open, value }) => {
        const handle = useCallback(() => work(value), [value]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);
    const stableResult = runPreferUseEffectEvent(`
      import * as React from "react";

      const { useCallback, useEffect, useRef } = React;

      const Search = ({ open }) => {
        const inputRef = useRef(null);
        const handle = useCallback(() => inputRef.current?.focus(), [inputRef]);
        useEffect(() => {
          const timeoutId = setTimeout(() => handle(), 100);
          return () => clearTimeout(timeoutId);
        }, [handle, open]);
        return null;
      };
    `);

    expect(changingResult.parseErrors).toEqual([]);
    expect(changingResult.diagnostics).toHaveLength(1);
    expect(stableResult.parseErrors).toEqual([]);
    expect(stableResult.diagnostics).toEqual([]);
  });

  it("stays silent when a React useCallback depends only on a useRef value", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useRef } from "react";

      const Composer = ({ open }) => {
        const inputRef = useRef(null);
        const focusInput = useCallback(() => inputRef.current?.focus(), [inputRef]);
        useEffect(() => {
          const timeoutId = setTimeout(() => focusInput(), 100);
          return () => clearTimeout(timeoutId);
        }, [focusInput, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a React useCallback depends only on startTransition", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useTransition } from "react";

      const Composer = ({ open }) => {
        const [, startTransition] = useTransition();
        const runDeferred = useCallback(() => startTransition(() => work()), [startTransition]);
        useEffect(() => {
          const timeoutId = setTimeout(() => runDeferred(), 100);
          return () => clearTimeout(timeoutId);
        }, [runDeferred, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a React useCallback depends only on a useEffectEvent handler", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useEffectEvent } from "react";

      const Composer = ({ open }) => {
        const onTick = useEffectEvent(() => work());
        const schedule = useCallback(() => onTick(), [onTick]);
        useEffect(() => {
          const timeoutId = setTimeout(() => schedule(), 100);
          return () => clearTimeout(timeoutId);
        }, [schedule, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a React useCallback depends only on a useActionState action", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useActionState } from "react";

      const Composer = ({ open }) => {
        const [, submitAction] = useActionState(submitForm, null);
        const submit = useCallback(() => submitAction(), [submitAction]);
        useEffect(() => {
          const timeoutId = setTimeout(() => submit(), 100);
          return () => clearTimeout(timeoutId);
        }, [submit, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a React useCallback whose dependency array has a sparse hole", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useState } from "react";

      const Composer = ({ open }) => {
        const [, setComposeOpen] = useState(false);
        const openComposer = useCallback(() => setComposeOpen(true), [setComposeOpen, , setComposeOpen]);
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a stable dispatch reaches the dependency array through a let alias", () => {
    const result = runPreferUseEffectEvent(`
      import { useCallback, useEffect, useReducer } from "react";

      const Composer = ({ open }) => {
        const [, dispatch] = useReducer(reducer, initialState);
        let dispatchAlias = dispatch;
        const openComposer = useCallback(() => dispatchAlias({ type: "open" }), [dispatchAlias]);
        useEffect(() => {
          const timeoutId = setTimeout(() => openComposer(), 100);
          return () => clearTimeout(timeoutId);
        }, [openComposer, open]);
        return null;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
