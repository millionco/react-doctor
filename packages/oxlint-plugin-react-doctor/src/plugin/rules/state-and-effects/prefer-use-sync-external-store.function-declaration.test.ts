import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferUseSyncExternalStore } from "./prefer-use-sync-external-store.js";

const cases = [
  {
    name: "same-effect-declaration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "existing-arrow-positive",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { const onResize=()=>setWidth(readWidth());window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "hoisted-declaration-after-registration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { window.addEventListener("resize", onResize);function onResize(){ setWidth(readWidth()); }return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }onResize=()=>{};window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-pattern-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }({onResize}=replacement);window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "async-handler-deferred",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { async function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "generator-handler-never-runs-body",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function* onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "shadowed-setter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function setWidth(){ setWidth(readWidth()); }window.addEventListener("resize",setWidth);return()=>window.removeEventListener("resize",setWidth); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "shadowed-getter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }function readWidth(){return 0;}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "literal-reset",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(false);  useEffect(() => { function onResize(){setWidth(false);}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "nonempty-dependencies",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, [seed]); return width; }\n',
    expected: 0,
  },
  {
    name: "wrong-cleanup-handler",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return()=>window.removeEventListener("resize",()=>{}); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "named-import-aliases",
    code: 'import { useEffect as watch, useState as createState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = createState(readWidth());  watch(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "effect-function-expression",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(function() { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "handler-returns-setter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ return setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "cleanup-block-return",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => { return window.removeEventListener("resize", onResize); }; }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "lazy-state-initializer",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(() => readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "direct-member-snapshot",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(window.innerWidth);  useEffect(() => { function onResize(){ setWidth(window.innerWidth); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "array-pattern-write",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }[onResize]=[replacement];window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "conditional-handler-write",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }if(replaceHandler)onResize=replacement;window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "loop-handler-write",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }for(onResize of replacements){}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "write-after-registration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize);onResize=replacement; }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "duplicate-handler",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }function onResize(){}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "aliased-handler",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }const savedHandler=onResize;window.addEventListener("resize", savedHandler);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "escaped-handler",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }consume(onResize);window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "direct-handler-call",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }onResize();window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "nested-declaration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { {function onResize(){ setWidth(readWidth()); }}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "conditional-declaration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { if(enabled){function onResize(){ setWidth(readWidth()); }}window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-parameter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(event){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-default-parameter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(event=0){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-rest-parameter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(...events){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "handler-additional-work",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth());consume(); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "conditional-setter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ if(enabled)setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "nested-setter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ Promise.resolve().then(()=>setWidth(readWidth())); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "extra-setter-argument",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth(),other); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "spread-setter-payload",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(...[readWidth()]); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "optional-setter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth?.(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "getter-replaced",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\nreadWidth=()=>0;',
    expected: 0,
  },
  {
    name: "getter-pattern-replaced",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n({readWidth}=replacement);',
    expected: 0,
  },
  {
    name: "setter-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }setWidth=replacement;window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "wrong-event",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("scroll", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "wrong-receiver",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => document.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "capture-options",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize,true);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "cleanup-options",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize,true); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "optional-registration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener?.("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "computed-registration",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window["addEventListener"]("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "no-cleanup",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "async-cleanup",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return async () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "async-effect",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(async () => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "effect-parameter",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect((unused) => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "effect-alias",
    code: 'import { useEffect, useState } from "react";\nconst watch=useEffect;const readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  watch(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "fake-react-provider",
    code: 'import { useEffect, useState } from "alternate-react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "type-only-react-import",
    code: 'import type { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "inline-type-react-import",
    code: 'import { type useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "react-default-provider-exposure",
    code: 'import React from "react";React.useEffect=replacement;import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "react-default-named-provider-exposure",
    code: 'import {default as React} from "react";React.useEffect=replacement;import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "shadowed-effect",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  ((useEffect)=>useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []))(fakeEffect); return width; }\n',
    expected: 0,
  },
  {
    name: "effect-import-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\nuseEffect=replacement;',
    expected: 0,
  },
  {
    name: "effect-import-pattern-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n({useEffect}=replacement);',
    expected: 0,
  },
  {
    name: "effect-import-loop-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\nfor(useEffect of replacements){}',
    expected: 0,
  },
  {
    name: "state-import-reassigned",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\nuseState=replacement;',
    expected: 0,
  },
  {
    name: "shadowed-window",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0, window = fakeWindow){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "multi-effect-work",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }consume();window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "literal-snapshot-reset",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(false);  useEffect(() => { function onResize(){ setWidth(false); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "different-getter-symbol",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(otherWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-registration-replacement",
    code: 'window.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-cleanup-replacement",
    code: 'window.removeEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "computed-window-replacement",
    code: 'window["addEventListener"]=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "resolved-window-replacement",
    code: 'const method="addEventListener";window[method]=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "pattern-window-replacement",
    code: '({method:window.addEventListener}=replacement);import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "loop-window-replacement",
    code: 'for(window.addEventListener of replacements){}import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-alias-replacement",
    code: 'const host=window;host.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-self-carrier",
    code: 'const host=window.window;host.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "global-window-carrier",
    code: 'globalThis.window.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-argument-escape",
    code: 'configure(window);import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "window-method-escape",
    code: 'configure(window.addEventListener);import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "reflective-window-replacement",
    code: 'Object.defineProperty(window,"addEventListener",{value:()=>{}});import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "cjs-react-provider",
    code: 'const provider=require("react");provider.useEffect=replacement;import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "unrelated-object-use",
    code: 'const metadata=Object.freeze({unit:1});import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "unrelated-reflect-use",
    code: 'const metadata=Reflect.get({unit:1},"unit");import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "shadowed-require-unrelated",
    code: 'const require=()=>({});const custom=require("react");custom.useEffect=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "legacy-later-inline-callback-precedence",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){}window.addEventListener("resize", onResize,()=>setWidth(readWidth()));return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "native-eventtarget-prototype",
    code: 'EventTarget.prototype.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "native-window-prototype",
    code: 'Window.prototype.removeEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "local-eventtarget-name",
    code: 'class EventTarget{};EventTarget.prototype.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "local-window-name",
    code: 'class Window{};Window.prototype.removeEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "native-frames-carrier",
    code: 'frames.EventTarget.prototype.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "local-frames-name",
    code: 'const frames={EventTarget:{prototype:{}}};frames.EventTarget.prototype.addEventListener=()=>{};import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
  {
    name: "arguments-snapshot-frame",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(arguments[0]);  useEffect(() => { function onResize(){ setWidth(arguments[0]); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "this-snapshot-frame",
    code: 'import { useEffect, useState } from "react";\nconst readWidth = () => window.innerWidth;\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(this.current);  useEffect(() => { function onResize(){ setWidth(this.current); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 0,
  },
  {
    name: "module-function-declaration-getter",
    code: 'import { useEffect, useState } from "react";\nfunction readWidth(){return window.innerWidth;}\nexport function useViewportWidth(seed = 0){ const [width, setWidth] = useState(readWidth());  useEffect(() => { function onResize(){ setWidth(readWidth()); }window.addEventListener("resize", onResize);return () => window.removeEventListener("resize", onResize); }, []); return width; }\n',
    expected: 1,
  },
];

const options = {
  filename: "src/hooks/use-viewport-width.ts",
  forceJsx: false,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react", "react:19"],
      portedRuleMode: "curated",
    },
  },
};

describe("prefer-use-sync-external-store function declarations", () => {
  for (const { name, code, expected } of cases) {
    it(name, () => {
      const result = runRule(preferUseSyncExternalStore, code, options);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    });
  }
});
