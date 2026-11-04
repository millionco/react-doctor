import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";
import { noInitializeState } from "./no-initialize-state.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const stateWriteCases = [
  {
    name: "derived state",
    rule: noDerivedState,
    component: `const Example = ({ value }) => {
      const [mirror, setMirror] = useState("");
      EFFECT(() => setMirror(value), [value]);
      return mirror;
    };`,
  },
  {
    name: "mount initialization",
    rule: noInitializeState,
    component: `const Example = ({ value }) => {
      const [mirror, setMirror] = useState("");
      EFFECT(() => setMirror(value), []);
      return mirror;
    };`,
  },
  {
    name: "prop-driven adjustment",
    rule: noAdjustStateOnPropChange,
    component: `const Example = ({ value }) => {
      const [selection, setSelection] = useState(null);
      EFFECT(() => setSelection(null), [value]);
      return <button onClick={() => setSelection(value)}>{selection}</button>;
    };`,
  },
  {
    name: "prop-driven reset",
    rule: noResetAllStateOnPropChange,
    component: `const Example = ({ documentId }) => {
      const [draft, setDraft] = useState("");
      EFFECT(() => setDraft(""), [documentId]);
      return <input value={draft} onChange={event => setDraft(event.target.value)} />;
    };`,
  },
];

describe.each(stateWriteCases)("$name effect hook contract", ({ rule, component }) => {
  it.each(["useEffect", "useLayoutEffect"])(
    "reports the same redundant write in %s",
    (hookName) => {
      const code = `import { ${hookName}, useState } from "react";
      ${component.replaceAll("EFFECT", hookName)}`;
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    ["named import alias", `import { useLayoutEffect as runLayout } from "react";`, "runLayout"],
    ["namespace import", `import * as ReactHooks from "react";`, "ReactHooks.useLayoutEffect"],
    ["default import", `import ReactHooks from "react";`, "ReactHooks.useLayoutEffect"],
    [
      "immutable local alias",
      `import { useLayoutEffect } from "react"; const runLayout = useLayoutEffect;`,
      "runLayout",
    ],
  ])("resolves a layout hook through a %s", (_name, imports, hookExpression) => {
    const code = `import { useState } from "react";
      ${imports}
      ${component.replaceAll("EFFECT", hookExpression)}`;
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["unrelated import", `import { useLayoutEffect } from "other-runtime";`, "useLayoutEffect"],
    [
      "local same-name function",
      `const useLayoutEffect = callback => callback();`,
      "useLayoutEffect",
    ],
    [
      "reassigned alias",
      `import { useLayoutEffect } from "react";
       let runLayout = useLayoutEffect;
       runLayout = callback => callback();`,
      "runLayout",
    ],
  ])("rejects an %s", (_name, imports, hookExpression) => {
    const code = `import { useState } from "react";
      ${imports}
      ${component.replaceAll("EFFECT", hookExpression)}`;
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a shadowed React layout hook", () => {
    const code = `import { useLayoutEffect, useState } from "react";
      ${component.replace("=> {", "=> { const useLayoutEffect = callback => callback();").replaceAll("EFFECT", "useLayoutEffect")}`;
    const result = runRule(rule, code, { forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("layout measurement state stays valid", () => {
  it.each([
    ["direct ref measurement", `setHeight(elementRef.current.getBoundingClientRect().height);`],
    [
      "helper-mediated measurement",
      `const measure = () => {
        const { height } = elementRef.current.getBoundingClientRect();
        setHeight(height);
      }; measure();`,
    ],
    ["DOM property measurement", `setHeight(elementRef.current.offsetHeight);`],
    ["callback-ref element availability", `setHeight(element.offsetHeight);`],
  ])("allows %s with mount and prop dependencies", (_name, measurement) => {
    for (const dependencies of ["[]", "[visible]"]) {
      const code = `import { useLayoutEffect as runLayout, useRef, useState } from "react";
        const Tooltip = ({ visible }) => {
          const elementRef = useRef(null);
          const [element, setElement] = useState(null);
          const [height, setHeight] = useState(0);
          runLayout(() => { ${measurement} }, ${dependencies});
          return <div ref={setElement} style={{ height }} hidden={!visible} />;
        };`;
      for (const rule of [
        ...stateWriteCases.map((testCase) => testCase.rule),
        noDerivedStateEffect,
      ]) {
        const result = runRule(rule, code, { forceJsx: true });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      }
    }
  });

  it.each([
    [
      "asynchronous results",
      `const Example = ({ resource }) => {
        const [result, setResult] = useState(null);
        runLayout(() => {
          let active = true;
          resource.load().then(value => { if (active) setResult(value); });
          return () => { active = false; };
        }, [resource]);
        return result;
      };`,
    ],
    [
      "resource failure events",
      `const Example = ({ source }) => {
        const [failed, setFailed] = useState(false);
        runLayout(() => setFailed(false), [source]);
        return <img src={source} hidden={failed} onError={() => setFailed(true)} />;
      };`,
    ],
    [
      "a sibling layout effect synchronizing playback",
      `const Example = ({ source }) => {
        const videoRef = useRef(null);
        const [failed, setFailed] = useState(false);
        runLayout(() => setFailed(false), [source]);
        runLayout(() => {
          const video = videoRef.current;
          if (video) video.play().catch(() => setFailed(true));
        }, [source]);
        return <video ref={videoRef} src={source} hidden={failed} />;
      };`,
    ],
  ])("preserves %s", (_name, component) => {
    const code = `import { useLayoutEffect as runLayout, useRef, useState } from "react"; ${component}`;
    for (const testCase of stateWriteCases) {
      const result = runRule(testCase.rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    ["a custom component ref", `<video src={source} /><Player ref={videoRef} />`],
    ["a different ref attached to the video", `<video src={source} ref={otherRef} />`],
  ])("does not exempt a failure reset based on %s", (_name, renderedElements) => {
    const code = `import { useLayoutEffect as runLayout, useRef, useState } from "react";
      const Example = ({ source }) => {
        const videoRef = useRef(null);
        const otherRef = useRef(null);
        const [failed, setFailed] = useState(false);
        runLayout(() => setFailed(false), [source]);
        runLayout(() => {
          const player = videoRef.current;
          if (player) player.play().catch(() => setFailed(true));
        }, [source]);
        return <>${renderedElements}</>;
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("still reports an editable draft reset alongside playback", () => {
    const code = `import { useLayoutEffect as runLayout, useRef, useState } from "react";
      const Example = ({ source }) => {
        const videoRef = useRef(null);
        const [draft, setDraft] = useState("");
        runLayout(() => setDraft(""), [source]);
        runLayout(() => {
          videoRef.current?.play().catch(() => setDraft("unavailable"));
        }, [source]);
        return <><video ref={videoRef} src={source} />
          <input value={draft} onChange={event => setDraft(event.target.value)} /></>;
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    ["unknown spread after ref", "", `<video ref={mediaRef} {...attributes} src={source} />`],
    ["unknown spread before ref", "", `<video {...attributes} ref={mediaRef} src={source} />`],
    ["spread ref override", "", `<video ref={mediaRef} {...{ ref: otherRef }} src={source} />`],
    ["duplicate ref override", "", `<video ref={mediaRef} ref={otherRef} src={source} />`],
    [
      "shared custom attachment",
      "",
      `<video ref={mediaRef} src={source} /><Player ref={mediaRef} />`,
    ],
    ["shared div attachment", "", `<video ref={mediaRef} src={source} /><div ref={mediaRef} />`],
    [
      "custom current assignment",
      "mediaRef.current = customPlayer;",
      `<video ref={mediaRef} src={source} />`,
    ],
    [
      "computed current assignment",
      `mediaRef["current"] = customPlayer;`,
      `<video ref={mediaRef} src={source} />`,
    ],
    ["deleted current", "delete mediaRef.current;", `<video ref={mediaRef} src={source} />`],
    ["escaped ref", "configure(mediaRef);", `<video ref={mediaRef} src={source} />`],
    [
      "ref alias escape",
      "const alias = mediaRef; configure(alias);",
      `<video ref={mediaRef} src={source} />`,
    ],
    [
      "assigned ref property",
      `Object.assign(mediaRef, { current: customPlayer });`,
      `<video ref={mediaRef} src={source} />`,
    ],
    [
      "escaped current value",
      "configure(mediaRef.current);",
      `<video ref={mediaRef} src={source} />`,
    ],
    [
      "escaped element alias",
      "const node = mediaRef.current; configure(node);",
      `<video ref={mediaRef} src={source} />`,
    ],
    [
      "mutated element alias",
      "const node = mediaRef.current; node.play = customPlayer.play;",
      `<video ref={mediaRef} src={source} />`,
    ],
  ])("rejects media ownership with %s", (_name, mutation, renderedElements) => {
    const code = `import { useLayoutEffect, useRef, useState } from "react";
      const Example = ({ source, attributes, customPlayer }) => {
        const mediaRef = useRef(null);
        const otherRef = useRef(null);
        const [failed, setFailed] = useState(false);
        useLayoutEffect(() => setFailed(false), [source]);
        useLayoutEffect(() => {
          ${mutation}
          const player = mediaRef.current;
          if (player) player.play().catch(() => setFailed(true));
        }, [source]);
        return <>${renderedElements}</>;
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects a ref initialized with a custom receiver before conditional media attachment", () => {
    const code = `import { useLayoutEffect, useRef, useState } from "react";
      const Example = ({ source, customPlayer }) => {
        const mediaRef = useRef(customPlayer);
        const [failed, setFailed] = useState(false);
        useLayoutEffect(() => setFailed(false), [source]);
        useLayoutEffect(() => {
          const player = mediaRef.current;
          if (player) player.play().catch(() => setFailed(true));
        }, [source]);
        return source ? <video ref={mediaRef} src={source} /> : null;
      };`;
    for (const rule of [noAdjustStateOnPropChange, noResetAllStateOnPropChange]) {
      const result = runRule(rule, code, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("keeps the already layout-aware derived-state rule firing", () => {
    const result = runRule(
      noDerivedStateEffect,
      `import { useLayoutEffect as runLayout, useState } from "react";
       ${stateWriteCases[0].component.replaceAll("EFFECT", "runLayout")}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
