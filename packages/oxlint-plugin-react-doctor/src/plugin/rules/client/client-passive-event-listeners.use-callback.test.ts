import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clientPassiveEventListeners } from "./client-passive-event-listeners.js";

interface CallbackFixture {
  name: string;
  code: string;
  expectedCount: number;
}

const fixtures: CallbackFixture[] = [
  {
    name: "default import cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "namespace import cancellation",
    code: 'import * as React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "named import cancellation",
    code: 'import { useCallback, useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "aliased named import cancellation",
    code: 'import { useCallback as memoize, useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = memoize((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "static computed namespace callback",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React["useCallback"]((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "namespace type references",
    code: 'import React from "react";\ninterface Props { update: React.Dispatch<React.SetStateAction<number>>; }\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "wrapped property-only read",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { console.info(event.deltaY); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "unrelated cancellation object",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { other.preventDefault(); console.info(event.deltaY); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "deferred cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { setTimeout(() => event.preventDefault(), 0); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "uninvoked nested cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { const cancel = () => event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "synchronous event forwarding",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { onMove(event); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "event-property forwarding",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { onMove(event.deltaY); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "explicit passive false",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { console.info(event.deltaY); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel, { passive: false });\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "legacy direct cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = (event: WheelEvent) => { event.preventDefault(); };\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "legacy direct property read",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = (event: WheelEvent) => { console.info(event.deltaY); };\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "legacy function declaration cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  function handleWheel(event: WheelEvent) { event.preventDefault(); }\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "foreign useCallback import",
    code: 'import { useCallback } from "other-hooks"; import { useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "fake React object",
    code: 'import { useEffect } from "react"; const React = { useCallback: () => () => {} };\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "unbound React namespace",
    code: 'import { useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-only named callback",
    code: 'import type { useCallback } from "react"; import { useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-only default React",
    code: 'import type React from "react"; import { useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "type-only namespace React",
    code: 'import type * as React from "react"; import { useEffect } from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "default provider replacement",
    code: 'import React from "react";\nReact.useCallback = () => () => {};\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "namespace provider replacement",
    code: 'import * as React from "react";\nReact.useCallback = () => () => {};\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named hook assignment",
    code: 'import { useCallback, useEffect } from "react";\nuseCallback = replacement;\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named object pattern assignment",
    code: 'import { useCallback, useEffect } from "react";\n({ useCallback } = replacement);\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named array pattern assignment",
    code: 'import { useCallback, useEffect } from "react";\n[useCallback] = replacement;\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named for-of replacement",
    code: 'import { useCallback, useEffect } from "react";\nfor (useCallback of replacements) {}\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "provider object pattern replacement",
    code: 'import React from "react";\n({ callback: React.useCallback } = replacement);\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "another default import replaces named hook",
    code: 'import Provider, { useCallback, useEffect } from "react";\nProvider.useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "another namespace import replaces named hook",
    code: 'import * as Provider from "react"; import { useCallback, useEffect } from "react";\nProvider.useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "provider value escape",
    code: 'import React from "react";\npublish(React);\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named hook value escape",
    code: 'import { useCallback, useEffect } from "react";\npublish(useCallback);\nconst Panel = () => {\n  const handleWheel = useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "provider alias replacement",
    code: 'import React from "react";\nconst Provider = React; Provider.useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "provider default projection",
    code: 'import React from "react";\nReact.default.useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "unknown computed provider property",
    code: 'import React from "react";\nReact[propertyName] = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "mutable handler binding",
    code: 'import React from "react";\n\nconst Panel = () => {\n  let handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "ordinary handler replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []); handleWheel = replacement;\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "handler object pattern replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []); ({ handleWheel } = replacement);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "event parameter replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event = other; event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "event parameter pattern replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { [event] = others; event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "event cancellation member replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault = () => {}; event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "event alias cancellation member replacement",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { const alias = event; alias.preventDefault = () => {}; event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "async callback",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback(async (event: WheelEvent) => { await wait(); event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "destructured event parameter",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback(({ preventDefault }: WheelEvent) => { preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "missing event parameter",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback(() => { other.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "extra callback parameter",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent, other: Event) => { other.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "function-expression callback",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback(function(event: WheelEvent) { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "callback identifier argument",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const cancel = (event: WheelEvent) => event.preventDefault(); const handleWheel = React.useCallback(cancel, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "missing dependency argument",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); });\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "extra hook argument",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, [], extra);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "spread callback argument",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const callbacks = [(event: WheelEvent) => event.preventDefault()]; const handleWheel = React.useCallback(...callbacks, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "spread dependencies",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, [...dependencies]);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "optional hook invocation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback?.((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "projected hook metadata",
    code: 'import React from "react";\nconst name = React.useCallback.name;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "other native React direct call",
    code: 'import React from "react";\nconst count = React.createRef<number>();\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "event return exposure",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => event, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "event container return exposure",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => ({ event }), []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "conditional own cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "shadowed React provider",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = ((React) => React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []))(fakeReact);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "synchronous callback cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { [1].forEach(() => event.preventDefault()); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "synchronous unrelated cancellation",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { (() => other.preventDefault())(); console.info(event.deltaY); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "selected handler alias",
    code: 'import React from "react";\n\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []); const alias = handleWheel;\n  React.useEffect(() => {\n    document.addEventListener("wheel", alias);\n    return () => document.removeEventListener("wheel", alias);\n  }, [alias]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "canonical React require replacement",
    code: 'import React from "react";\n\nrequire("react").useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "module loader replacement",
    code: 'import React from "react";\n\nmodule.require("react").useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "named Node module factory provider",
    code: 'import React from "react"; import { createRequire } from "node:module";\n\nconst localRequire = createRequire(import.meta.url); localRequire("react").useCallback = replacement;\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "direct eval provider replacement",
    code: 'import React from "react";\n\neval("React.useCallback = replacement");\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "global Function provider exposure",
    code: 'import React from "react";\n\nwindow.Function("return replacement")();\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "native event cancellation replacement",
    code: 'import React from "react";\n\nEvent.prototype.preventDefault = () => {};\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
  {
    name: "shadowed require is not global",
    code: 'import React from "react";\n\nconst require = () => null; require();\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "shadowed Event is not native",
    code: 'import React from "react";\n\nconst Event = { value: 1 }; console.info(Event.value);\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 0,
  },
  {
    name: "native event prototype carrier replacement",
    code: 'import React from "react";\nCustomEvent.prototype.__proto__.preventDefault = () => {};\nconst Panel = () => {\n  const handleWheel = React.useCallback((event: WheelEvent) => { event.preventDefault(); }, []);\n  React.useEffect(() => {\n    document.addEventListener("wheel", handleWheel);\n    return () => document.removeEventListener("wheel", handleWheel);\n  }, [handleWheel]);\n  return null;\n};\n',
    expectedCount: 1,
  },
];

describe("client-passive-event-listeners React callback wrappers", () => {
  it.each(fixtures)("$name", ({ code, expectedCount }) => {
    const result = runRule(clientPassiveEventListeners, code, {
      filename: "/repo/src/panel.tsx",
      forceJsx: true,
      settings: {
        "react-doctor": { reactVersion: "19.0.0", reactMajorVersion: 19, capabilities: ["react"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
