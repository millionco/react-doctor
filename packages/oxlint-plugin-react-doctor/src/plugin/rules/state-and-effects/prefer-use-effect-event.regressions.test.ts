import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseEffectEvent } from "./prefer-use-effect-event.js";

const runPreferUseEffectEvent = (code: string) => runRule(preferUseEffectEvent, code);

describe("prefer-use-effect-event — callback stability regressions", () => {
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
