import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

interface NativeTouchendCase {
  name: string;
  code: string;
  options: RunRuleOptions;
  expectedCount: number;
}

const cases: NativeTouchendCase[] = [
  {
    name: "direct-native-div-first-removed-touch-coordinate-pair",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX, event.changedTouches[0].clientY)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-00.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "direct-native-button-synchronous-block",
    code: 'import type { TouchEvent } from "react";\nexport const TouchButton = () => <button onTouchEnd={(event: TouchEvent<HTMLButtonElement>) => { const coordinate = event.changedTouches[0].clientX; console.log(coordinate); }}>Touch</button>;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-01.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-nested-binding-cannot-hide-event-list-overwrite",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { const replace = () => { interface event {} event.changedTouches = []; }; replace(); console.log(event.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-02.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "remaining-touches-can-be-empty-at-release",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.touches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-03.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "remaining-target-touches-can-be-empty-at-release",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.targetTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-04.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "second-removed-touch-not-guaranteed",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[1].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-05.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "custom-callback-can-deliver-empty-list",
    code: 'import type { TouchEvent } from "react";\ninterface PadProps { onTouchEnd: (event: { changedTouches: Array<{ clientX: number }> }) => void; }\nconst CustomPad = ({ onTouchEnd }: PadProps) => <button onClick={() => onTouchEnd({ changedTouches: [] })}>Touch</button>;\nexport const TouchPad = () => <CustomPad onTouchEnd={(event) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-06.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "touchcancel-is-separate-deferred-native-policy",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchCancel={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-07.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "touchstart-existing-phase-outside-target-end-path",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchStart={(event: TouchEvent<HTMLDivElement>) => console.log(event.touches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-08.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "touchmove-existing-phase-outside-target-end-path",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchMove={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-09.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "capture-phase-not-silently-new-coverage",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEndCapture={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-10.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "source-visible-empty-constructed-touchend-dispatch",
    code: 'import type { TouchEvent as ReactTouchEvent } from "react";\nexport const dispatchEmptyEnd = (element: HTMLDivElement) => element.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [] }));\nexport const TouchPad = () => <div onTouchEnd={(event: ReactTouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-11.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "selected-parameter-reassigned-to-empty-payload",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { event = { changedTouches: [] }; console.log(event.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-12.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "react-event-wrapper-list-overwritten",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { Object.defineProperty(event, "changedTouches", { value: [] }); console.log(event.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-13.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "selected-event-alias-opaque-transport",
    code: 'import type { TouchEvent } from "react";\nconst clear = (payload: { changedTouches: unknown }) => Object.defineProperty(payload, "changedTouches", { value: [] });\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { const alias = event; clear(alias); console.log(event.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-14.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "list-alias-no-new-provenance-credit",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { const changed = event.changedTouches; console.log(changed[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-15.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "deferred-capture-not-direct-synchronous-handler-use",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { queueMicrotask(() => console.log(event.changedTouches[0].clientX)); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-16.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "different-payload-is-not-handler-event",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { const replacement = { changedTouches: [] }; console.log(replacement.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-17.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "optional-index-deref-existing-quiet",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0]?.clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-18.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "custom-lowercase-element-is-not-known-dom-tag",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <custom-pad onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-19.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "custom-jsx-factory-not-react-event-certificate",
    code: '/** @jsx createElement */\nimport type { TouchEvent } from "react";\nconst createElement = (tag: unknown, props: { onTouchEnd?: (event: { changedTouches: unknown[] }) => unknown }) => { props.onTouchEnd?.({ changedTouches: [] }); return null; };\nexport const TouchPad = () => <div onTouchEnd={(event) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-20.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "react-create-element-provider-write",
    code: 'import type { TouchEvent } from "react";\nimport React from "react";\nReact.createElement = (tag, props) => { props.onTouchEnd?.({ changedTouches: [] }); return null; };\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-21.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-index-alias-not-exact-literal-zero",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => { const index = 0; return <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[index].clientX)} />; };\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-22.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ambient-eval-can-overwrite-wrapper",
    code: 'import type { TouchEvent } from "react";\ndeclare const eval: (text: string) => unknown;\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { eval("event.changedTouches = []"); console.log(event.changedTouches[0].clientX); }} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-23.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "spread-props-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div {...attributes} onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-24.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "duplicate-handler-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={() => undefined} onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-25.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "customized-built-in-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div is="custom-pad" onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-26.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "default-event-parameter-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement> = fallback) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-27.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "extra-handler-parameter-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>, extra = observe()) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-28.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "async-handler-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={async (event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-29.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "coordinate-write-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => event.changedTouches[0].clientX = 1} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-30.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "coordinate-as-callable-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => event.changedTouches[0].clientX()} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-31.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "coordinate-member-chain-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => event.changedTouches[0].clientX.toString()} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-32.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "non-next-profile-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-33.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "vite",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "preact-profile-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-34.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
            "pure-preact",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "secondary-react-namespace-exposure-veto",
    code: 'import * as SecondaryReact from "react";\nobserve(SecondaryReact);\nimport type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-35.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "computed-dispatch-selector-veto",
    code: 'const eventMethod = "dispatchEvent";\nexport const dispatch = (element: HTMLDivElement) => element[eventMethod](payload);\nimport type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-36.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-native-react-provider-use",
    code: 'import { useRef } from "react";\nimport type { TouchEvent } from "react";\nexport const TouchPad = () => { const coordinate = useRef(0); return <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => { coordinate.current = event.changedTouches[0].clientX; }} />; };\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-37.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "mixed-native-version-profile-veto",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => console.log(event.changedTouches[0].clientX, event.changedTouches[0].clientY)} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-38.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
            "react-native:0.81",
          ],
        },
      },
    },
    expectedCount: 2,
  },
  {
    name: "asserted-coordinate-callable-consumer-declines",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => (event.changedTouches[0].clientX as unknown as (() => void))()} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-39.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "asserted-coordinate-member-consumer-declines",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => (event.changedTouches[0].clientX as number).toString()} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-40.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "asserted-coordinate-template-tag-consumer-declines",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => (event.changedTouches[0].clientX as unknown as ((parts: TemplateStringsArray) => string))`value`} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-41.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "asserted-coordinate-constructed-consumer-declines",
    code: 'import type { TouchEvent } from "react";\nexport const TouchPad = () => <div onTouchEnd={(event: TouchEvent<HTMLDivElement>) => new (event.changedTouches[0].clientX as unknown as (new () => object))()} />;\n',
    options: {
      filename: "src/native-touchend-changed-touches/case-42.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          framework: "nextjs",
          capabilities: [
            "nextjs",
            "nextjs:15",
            "nextjs:16",
            "react",
            "react:17",
            "react:18",
            "react:19",
          ],
        },
      },
    },
    expectedCount: 1,
  },
];

describe("native touchend changed touch coordinates", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

const wrappedSource =
  'import type { TouchEvent } from "react"; export const WrappedPad = () => <button onTouchEnd={(event: TouchEvent<HTMLButtonElement>) => console.log(event.changedTouches[0].clientX)}>Touch</button>;';
const wrappedOptions: RunRuleOptions = {
  filename: "src/native-touchend-changed-touches/case-01.tsx",
  forceJsx: false,
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      framework: "nextjs",
      capabilities: [
        "nextjs",
        "nextjs:15",
        "nextjs:16",
        "react",
        "react:17",
        "react:18",
        "react:19",
      ],
    },
  },
};

describe("native touchend full-source host", () => {
  it("admits the selected coordinate through the production semantic wrapper", () => {
    const result = runRule(
      wrapWithSemanticContext(noArrayIndexDerefWithoutBoundsOrEmptyGuard),
      wrappedSource,
      wrappedOptions,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains a custom JSX pragma warning through the production semantic wrapper", () => {
    const result = runRule(
      wrapWithSemanticContext(noArrayIndexDerefWithoutBoundsOrEmptyGuard),
      `/** @jsx customElement */
${wrappedSource}`,
      wrappedOptions,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("declines when a host does not supply the complete source", () => {
    const rule = {
      ...noArrayIndexDerefWithoutBoundsOrEmptyGuard,
      create: (context: RuleContext) =>
        noArrayIndexDerefWithoutBoundsOrEmptyGuard.create({ ...context, sourceCode: undefined }),
    };
    const result = runRule(rule, wrappedSource, wrappedOptions);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
