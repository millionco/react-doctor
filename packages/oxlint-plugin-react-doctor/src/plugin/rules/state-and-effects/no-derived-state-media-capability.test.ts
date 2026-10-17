import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const testOptions = {
  includeLocations: true,
  forceJsx: true,
  filename: "synthetic-media-panel.tsx",
};

describe.each([noDerivedState, noDerivedStateEffect])("native media capability state", (rule) => {
  it.each([
    {
      name: "fresh video result truthiness",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "fresh audio result truthiness",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("audio").canPlayType("audio/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "readonly receiver aliases",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("audio"); const alias = probe; if (alias.canPlayType("audio/example") !== "") setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "readonly support alternatives",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if (support === "maybe" || support === "probably") setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "readonly support aliases",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); const alias = support; if (alias) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "native empty support outcome",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("video").canPlayType("video/example") === "") setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "native negated truthiness",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (!document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "native early exit",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (!document.createElement("video").canPlayType("video/example")) return; setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "native short circuit setter",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { document.createElement("video").canPlayType("video/example") && setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "native conditional setter",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { document.createElement("video").canPlayType("video/example") ? setAcceptedKey(sourceKey) : null; }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "harmless setter metadata read",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { setAcceptedKey.description; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "known computed key and default reads",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const slot = "label"; const {[slot]: label = sourceKey} = {}; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(label); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "pure prop guard",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (enabled) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "discarded native comma operand",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if ((support, enabled)) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "constant native OR operand",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if (support || true) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "native self comparison",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if (support === support) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "native coerced self comparison",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if (!!support === !!support) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "complementary native alternatives",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const support = document.createElement("video").canPlayType("video/example"); if (support === "" || support !== "") setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "shadowed document",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const document = { createElement: () => ({canPlayType: () => enabled}) }; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "custom media object",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = {canPlayType: () => enabled}; if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "factory replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { document.createElement = () => ({canPlayType: () => enabled}); if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "receiver method replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); probe.canPlayType = () => enabled; if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "receiver method pattern replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); ({replacement: probe.canPlayType} = {replacement: () => enabled}); if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "receiver method loop replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); for (probe.canPlayType of [() => enabled]) {} if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "receiver opaque escape",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); install(probe); if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "mutable receiver alias",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { let probe = document.createElement("video"); if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "mutable support alias",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { let support = document.createElement("video").canPlayType("video/example"); support = enabled; if (support) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "nonmedia element",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("div").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "method extraction",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); const readSupport = probe.canPlayType; if (readSupport("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "native media prototype replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { HTMLMediaElement.prototype.canPlayType = () => "probably"; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "native method Reflect replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const probe = document.createElement("video"); Reflect.set(probe,"canPlayType",()=>enabled); if (probe.canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "global namespace document exposure",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const provider = globalThis.document; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "native provider opaque escape",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { install(document); if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "guarded and unguarded helper calls",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const update = () => setAcceptedKey(sourceKey); if (document.createElement("video").canPlayType("video/example")) update(); update(); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 2,
      expectedEffect: 1,
    },
    {
      name: "nested helper call contexts",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { const update = () => setAcceptedKey(sourceKey); const delegate = () => update(); if (document.createElement("video").canPlayType("video/example")) delegate(); delegate(); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "setter binding replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { setAcceptedKey = customSetter; if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "alternate React origin",
      source:
        'import { useEffect, useState } from "alternate-react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "same module state provider replacement",
      source:
        'import React, { useEffect, useState } from "react";\nReact.useState = customState; const MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "same module effect provider replacement",
      source:
        'import React, { useEffect, useState } from "react";\nReact.useEffect = customEffect; const MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "state tuple pattern replacement",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { ({replace: setAcceptedKey} = {replace: customSetter}); if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "mixed pure and capability writes",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null); const [copy, setCopy] = useState(null); useEffect(() => { setCopy(sourceKey); if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "constant reset before capability",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey, enabled }) => { const [acceptedKey, setAcceptedKey] = useState(null);  useEffect(() => { setAcceptedKey(null); if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey); }, [sourceKey, enabled]); return acceptedKey; };',
      expectedState: 0,
      expectedEffect: 0,
    },
    {
      name: "same-state pure write retained beside capability and cleanup",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey }) => {\n  const [acceptedKey, setAcceptedKey] = useState(null);\n  useEffect(() => {\n    setAcceptedKey(sourceKey);\n    if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey);\n    return () => {};\n  }, [sourceKey]);\n  return acceptedKey;\n};\n',
      expectedState: 1,
      expectedEffect: 1,
    },
    {
      name: "distinct-state pure write retained beside capability and cleanup",
      source:
        'import { useEffect, useState } from "react";\nconst MediaPanel = ({ sourceKey }) => {\n  const [acceptedKey, setAcceptedKey] = useState(null);\n  const [copy, setCopy] = useState(null);\n  useEffect(() => {\n    setCopy(sourceKey);\n    if (document.createElement("video").canPlayType("video/example")) setAcceptedKey(sourceKey);\n    return () => {};\n  }, [sourceKey]);\n  return [acceptedKey, copy];\n};\n',
      expectedState: 1,
      expectedEffect: 1,
    },
  ])("$name", ({ source, expectedState, expectedEffect }) => {
    const result = runRule(rule, source, testOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(
      rule === noDerivedState ? expectedState : expectedEffect,
    );
  });
});
