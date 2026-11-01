import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import { defineRule } from "../../../utils/define-rule.js";
import { isComponentAssignment } from "../../../utils/is-component-assignment.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { wrapWithSemanticContext } from "../../../utils/wrap-with-semantic-context.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { rerenderStateOnlyInHandlers } from "../rerender-state-only-in-handlers.js";
import { collectUseStateBindings } from "./collect-use-state-bindings.js";
import { hasPairedRenderRefNotification } from "./has-paired-render-ref-notification.js";

interface NotificationCase {
  name: string;
  source: string;
  accepted: boolean;
  ruleReports?: number;
}

const panel = `
import { useCallback, useLayoutEffect, useRef, useState } from "react";
export const StatusPanel = () => {
  const [phase, setPhase] = useState("idle");
  const phaseRef = useRef("idle");
  useLayoutEffect(() => {
    if (phaseRef.current !== phase) setPhase(phaseRef.current);
  }, [phase]);
  const activate = useCallback(() => {
    phaseRef.current = "busy";
    setPhase("busy");
  }, []);
  return <button onClick={activate}>{phaseRef.current}</button>;
};
`;

const refWrite = '    phaseRef.current = "busy";';
const publication = '    setPhase("busy");';
const display = "{phaseRef.current}";
const helperPanel = panel.replace(
  "  return <button onClick={activate}>{phaseRef.current}</button>;",
  "  const renderAction = () => <button onClick={activate}>Run</button>;\n" +
    "  return <div>{renderAction()}<span>{phaseRef.current}</span></div>;",
);
const cases: NotificationCase[] = [
  { name: "accepts events in a closed native render helper", source: helperPanel, accepted: true },
  {
    name: "accepts an anonymous constant function-expression render helper",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "function () { return <button onClick={activate}>Run</button>; }",
    ),
    accepted: true,
  },
  {
    name: "declines a named render helper with a separate self binding",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "function repeat() { repeat(); return <button onClick={activate}>Run</button>; }",
    ),
    accepted: false,
  },
  {
    name: "accepts a closed helper containing both event and distinct display branches",
    source: helperPanel
      .replace(
        "() => <button onClick={activate}>Run</button>",
        '() => { if (phaseRef.current === "busy") return <span>Working</span>; return <section><button onClick={activate}>Run</button><button onClick={activate}>Start</button></section>; }',
      )
      .replace("<span>{phaseRef.current}</span></div>", "</div>"),
    accepted: true,
  },
  {
    name: "accepts a guarded native event inside a closed render helper",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => <section>{ready && <button onClick={activate}>Run</button>}</section>",
    ),
    accepted: true,
  },
  {
    name: "accepts a closed render helper in a guarded native child",
    source: helperPanel.replace("{renderAction()}", "{ready && renderAction()}"),
    accepted: true,
  },
  {
    name: "accepts a closed render helper in a conditional native child",
    source: helperPanel.replace("{renderAction()}", "{ready ? renderAction() : null}"),
    accepted: true,
  },
  {
    name: "declines a discarded render helper result",
    source: helperPanel.replace("  return <div>{renderAction()}", "  renderAction(); return <div>"),
    accepted: false,
  },
  {
    name: "declines one discarded render helper call beside a returned call",
    source: helperPanel.replace("  return <div>", "  renderAction(); return <div>"),
    accepted: false,
  },
  {
    name: "declines an escaped render helper",
    source: helperPanel.replace("  return <div>", "  consume(renderAction); return <div>"),
    accepted: false,
  },
  {
    name: "declines a mutable render helper",
    source: helperPanel.replace("const renderAction", "let renderAction"),
    accepted: false,
  },
  {
    name: "declines an asynchronous render helper",
    source: helperPanel.replace("renderAction = ()", "renderAction = async ()"),
    accepted: false,
  },
  {
    name: "declines a render helper parameter default",
    source: helperPanel.replace("renderAction = ()", "renderAction = (value = alter())"),
    accepted: false,
  },
  {
    name: "declines arguments passed into a render helper",
    source: helperPanel.replace("{renderAction()}", "{renderAction(alter())}"),
    accepted: false,
  },
  {
    name: "declines an aliased render helper",
    source: helperPanel.replace(
      "  return <div>{renderAction()}",
      "  const draw = renderAction; return <div>{draw()}",
    ),
    accepted: false,
  },
  {
    name: "declines a render helper passed through a custom component",
    source: helperPanel.replace("{renderAction()}", "<Custom>{renderAction()}</Custom>"),
    accepted: false,
  },
  {
    name: "declines a render helper call in an event callback",
    source: helperPanel.replace(
      "{renderAction()}",
      "<button onClick={() => renderAction()}>Run</button>",
    ),
    accepted: false,
  },
  {
    name: "declines a statically inactive guarded render helper call",
    source: helperPanel.replace("{renderAction()}", "{false && renderAction()}"),
    accepted: false,
  },
  {
    name: "declines a constant alias guarding an inactive render helper call",
    source: helperPanel.replace(
      "  return <div>{renderAction()}",
      "  const visible = false; return <div>{visible && renderAction()}",
    ),
    accepted: false,
  },
  {
    name: "declines a statically inactive conditional render helper call",
    source: helperPanel.replace("{renderAction()}", "{false ? renderAction() : null}"),
    accepted: false,
  },
  {
    name: "declines a statically inactive event inside a render helper",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => <section>{false && <button onClick={activate}>Run</button>}</section>",
    ),
    accepted: false,
  },
  {
    name: "declines a render helper called only after a terminal return",
    source: helperPanel.replace("  return <div>", "  return null; return <div>"),
    accepted: false,
  },
  {
    name: "declines a constant false helper event return arm",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => { const visible = false; if (visible) return <button onClick={activate}>Run</button>; return null; }",
    ),
    accepted: false,
  },
  {
    name: "declines a constant true alternate helper event return arm",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => { const inactive = true; if (inactive) return null; else return <button onClick={activate}>Run</button>; }",
    ),
    accepted: false,
  },
  {
    name: "declines a constant false component helper-call return arm",
    source: helperPanel.replace(
      "  return <div>",
      "  const visible = false; if (visible) return <div>",
    ),
    accepted: false,
  },
  {
    name: "declines loop-controlled helper event returns",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => { while (ready) return <button onClick={activate}>Run</button>; return null; }",
    ),
    accepted: false,
  },
  {
    name: "declines a finally block overriding the helper event return",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => { try { return <button onClick={activate}>Run</button>; } finally { return null; } }",
    ),
    accepted: false,
  },
  {
    name: "declines a loop preceding the helper event return",
    source: helperPanel.replace(
      "() => <button onClick={activate}>Run</button>",
      "() => { while (ready) {} return <button onClick={activate}>Run</button>; }",
    ),
    accepted: false,
  },
  ...["template", "noscript", "textarea", "iframe", "input", "img"].map((tag) => ({
    name: "declines inactive or unsupported display children inside " + tag,
    source: panel.replace(display, "<" + tag + ">{phaseRef.current}</" + tag + ">"),
    accepted: false,
    ruleReports: 1,
  })),
  {
    name: "declines an ambient function Object provider",
    source: "declare function Object(): unknown;\nObject.keys({});\n" + panel,
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines an ambient const Object provider",
    source:
      "declare const Object: { keys: (value: unknown) => unknown };\nObject.keys({});\n" + panel,
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "keeps an erased interface Object beside a genuine passive call",
    source: "interface Object {}\nObject.keys({});\n" + panel,
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "keeps an erased type Object beside a genuine passive call",
    source: "type Object = unknown;\nObject.keys({});\n" + panel,
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "declines a runtime shadowed passive Object provider",
    source: "const Object = { keys: (value) => value };\nObject.keys({});\n" + panel,
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "keeps an unused ambient Object declaration",
    source: "declare function Object(): unknown;\n" + panel,
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "preserves an actual document title text publication",
    source: panel.replace(display, "<title>{phaseRef.current}</title>"),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "declines an unknown React event attribute",
    source: panel.replace("onClick={activate}", "onNotAReactEvent={activate}"),
    accepted: false,
    ruleReports: 1,
  },
  ...[
    "<Drop><button onClick={activate}>Run</button></Drop>",
    "<template><button onClick={activate}>Run</button></template>",
    "<fieldset disabled><button onClick={activate}>Run</button></fieldset>",
    "<fieldset {...{disabled:true}}><button onClick={activate}>Run</button></fieldset>",
  ].map((event) => ({
    name: "declines an event host without a native rendered event witness " + event,
    source: panel
      .replace(
        "export const StatusPanel",
        "const Drop = ({children}) => null;\nexport const StatusPanel",
      )
      .replace(
        "return <button onClick={activate}>{phaseRef.current}</button>;",
        "return <>" + event + "<span>{phaseRef.current}</span></>;",
      ),
    accepted: false,
    ruleReports: 1,
  })),
  ...["section", "input", "textarea"].map((tag) => ({
    name: "preserves a real native click host " + tag,
    source: panel.replace(
      "return <button onClick={activate}>{phaseRef.current}</button>;",
      tag === "section"
        ? "return <><section><button onClick={activate}>Run</button></section><span>{phaseRef.current}</span></>;"
        : "return <><" + tag + " onClick={activate}/><span>{phaseRef.current}</span></>;",
    ),
    accepted: true,
    ruleReports: 0,
  })),
  {
    name: "declines an explicit custom JSX factory",
    source: "/** @jsx customJsx */\nconst customJsx=(tag,props,...children)=>null;\n" + panel,
    accepted: false,
    ruleReports: 1,
  },
  ...[
    'const note="@jsx customJsx";',
    'const notes={Function:"note",Object:"note",module:"note"};',
    "class Notes { static Function() {} }",
    "type Notes = ({Function}:{Function:string}) => void;",
    'Object.keys({note:"passive"});',
    'Object.freeze({note:"passive"});',
  ].map((prefix) => ({
    name: "preserves inert metadata or a genuine passive builtin " + prefix,
    source: prefix + "\n" + panel,
    accepted: true,
    ruleReports: 0,
  })),
  ...["interface useCallback {}", "type useCallback = unknown;"].map((prefix) => ({
    name: "preserves the unique runtime callback import beside " + prefix,
    source: panel.replace("export const StatusPanel", prefix + "\nexport const StatusPanel"),
    accepted: true,
    ruleReports: 0,
  })),
  ...[
    'import ReactProvider from "react"; ReactProvider.useRef=()=>({current:"idle"});',
    'import {default as ReactProvider} from "react"; ReactProvider.useRef=()=>({current:"idle"});',
    'const replace = Function("return 1");',
    'module["require"]("react").useRef=()=>({current:"idle"});',
  ].map((prefix) => ({
    name: "declines an alternate mutable runtime provider path " + prefix,
    source: panel.replace("export const StatusPanel", prefix + "\nexport const StatusPanel"),
    accepted: false,
    ruleReports: 1,
  })),

  {
    name: "declines a named writer without any native event use",
    source: panel.replace("onClick={activate}", ""),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines an arbitrary callback factory around a paired writer",
    source: panel.replace("const activate = useCallback(", "const activate = runNow("),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a paired reset exposed through an object method",
    source: panel
      .replace(
        "  const activate",
        '  const helpers = { reset() { phaseRef.current = "idle"; setPhase("idle"); } };\n  const activate',
      )
      .replace("  return <button", "  helpers.reset();\n  return <button"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "does not select a nested callback as a terminal publication",
    source: panel.replace(
      publication,
      publication + '\n    result.then(() => { phaseRef.current = "done"; setPhase("done"); });',
    ),
    accepted: false,
    ruleReports: 1,
  },
  ...[
    "reset();",
    "const resetAlias = reset; resetAlias();",
    "const renderStatus = () => { reset(); return <span>{phaseRef.current}</span>; };",
  ].map((invocation) => ({
    name: "declines a paired local writer exposed outside native events " + invocation,
    source: panel
      .replace(
        "  const activate",
        '  const reset = () => { if (phaseRef.current !== "idle") { phaseRef.current = "idle"; setPhase("idle"); } };\n  const activate',
      )
      .replace("  return <button", "  " + invocation + "\n  return <button"),
    accepted: false,
    ruleReports: 1,
  })),
  {
    name: "declines equal ternary text containing whitespace",
    source: panel.replace(
      display,
      '{phaseRef.current === "busy" ? <span>Ready now</span> : "Ready now"}',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines raw text under contradictory ref guards",
    source: panel.replace(
      display,
      '{(phaseRef.current === "busy" && phaseRef.current === "idle") && <span>{phaseRef.current}</span>}',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a self-gated raw snapshot alias",
    source: panel
      .replace(
        "  return <button",
        '  const shown = phaseRef.current === "busy" && phaseRef.current === "idle" ? phaseRef.current : "Ready";\n  return <button',
      )
      .replace(display, "{shown}"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines matching text with an opaque child between static segments",
    source: panel
      .replace(
        "  return <button",
        '  const renderStatus = () => { if (phaseRef.current === "busy") return <span>Bu{renderExtra()}sy</span>; return <span>Buxsy</span>; };\n  return <button',
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines mutually exclusive tests of the same ref",
    source: panel.replace(
      display,
      '{(phaseRef.current === "busy" && phaseRef.current === "idle") && <span>Busy</span>}',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a tautology through a readonly predicate alias",
    source: panel
      .replace("  return <button", '  const busy = phaseRef.current === "busy";\n  return <button')
      .replace(display, "{(busy || !busy) && <span>Busy</span>}"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines opaque combinations of alternative text children",
    source: panel
      .replace(
        "  return <button",
        '  const renderStatus = () => { if (phaseRef.current === "busy") return <span>Busy</span>; return <span>{flag ? "B" : "X"}{flag ? "usy" : "Y"}</span>; };\n  return <button',
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines text that is equal after adjacent text children concatenate",
    source: panel
      .replace(
        "  return <button",
        '  const renderStatus = () => { if (phaseRef.current === "busy") return <span>Busy</span>; return <span>{"Bu"}{"sy"}</span>; };\n  return <button',
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a conditional opaque JSX component",
    source: panel
      .replace("  return <button", "  const Ignore = () => null;\n  return <button")
      .replace(display, '{phaseRef.current === "busy" && <Ignore>Busy</Ignore>}'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines publication under a false constant alias",
    source: panel
      .replace("  const activate", "  const never = false;\n  const activate")
      .replace(
        refWrite + "\n" + publication,
        "    if (never) {\n" + refWrite + "\n" + publication + "\n    }",
      ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines text inside an opaque JSX component",
    source: panel
      .replace("  return <button", "  const Ignore = () => null;\n  return <button")
      .replace(display, '{phaseRef.current === "busy" ? <Ignore>Busy</Ignore> : null}'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines hidden text in an otherwise identical native branch",
    source: panel
      .replace(
        "  return <button",
        '  const renderStatus = () => { if (phaseRef.current === "busy") return <div>{false && "Busy"}</div>; return <div/>; };\n  return <button',
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a primitive kind change with identical text",
    source: panel.replaceAll('"idle"', "1").replaceAll('"busy"', '"1"'),
    accepted: false,
    ruleReports: 1,
  },
  ...[
    "{!<span>{phaseRef.current}</span>}",
    "{<span>{phaseRef.current}</span> && <b>Ready</b>}",
    "{(<span>{phaseRef.current}</span>).type}",
  ].map((replacement) => ({
    name: "declines discarded JSX value " + replacement,
    source: panel.replace(display, replacement),
    accepted: false,
    ruleReports: 1,
  })),
  {
    name: "declines a helper used as a truthiness test",
    source: panel
      .replace(
        "  return <button",
        "  const renderStatus = () => <span>{phaseRef.current}</span>;\n  return <button",
      )
      .replace(display + "</button>", "{renderStatus() ? <b>Ready</b> : <b>Ready</b>}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a ref display in a dead ternary branch",
    source: panel.replace(display, "{true ? 'Ready' : <span>{phaseRef.current}</span>}"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a render helper in a dead ternary branch",
    source: panel
      .replace(
        "  return <button",
        "  const renderStatus = () => <span>{phaseRef.current}</span>;\n  return <button",
      )
      .replace(display + "</button>", "{false ? renderStatus() : 'Ready'}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines identical if and fallthrough output",
    source: panel
      .replace(
        "  return <button",
        '  const renderStatus = () => { if (phaseRef.current === "busy") return <span>Ready</span>; return <span>Ready</span>; };\n  return <button',
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "does not render JSX stored in an attribute object",
    source: panel.replace(
      "<button onClick={activate}>{phaseRef.current}</button>",
      "<button onClick={activate} data-payload={{ view: <span>{phaseRef.current}</span> }}>Ready</button>",
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "does not render JSX passed as a scalar attribute",
    source: panel.replace(
      "<button onClick={activate}>{phaseRef.current}</button>",
      "<button onClick={activate} data-payload={<span>{phaseRef.current}</span>}>Ready</button>",
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects a render reset under a constant alias",
    source: panel.replace(
      "  const activate",
      '  const changed = true;\n  if (changed) phaseRef.current = "idle";\n  const activate',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects a render reset under a negated constant",
    source: panel.replace(
      "  const activate",
      '  if (!false) phaseRef.current = "idle";\n  const activate',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a negated constant display mask",
    source: panel.replace(
      display,
      '{(phaseRef.current === "busy" || !false) && <span>Ready</span>}',
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a truthy scalar display mask",
    source: panel.replace(display, '{(phaseRef.current === "busy" || 1) && <span>Ready</span>}'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines a statically unreachable publication",
    source: panel.replace(
      refWrite + "\n" + publication,
      "    if (false) {\n" + refWrite + "\n" + publication + "\n    }",
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "publishes a private string ref through state",
    source: panel,
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "declines native attributes as display proof",
    source: panel
      .replaceAll('"idle"', "false")
      .replaceAll('"busy"', "true")
      .replace(
        "<button onClick={activate}>{phaseRef.current}</button>",
        "<button disabled={phaseRef.current} onClick={activate}>Continue</button>",
      ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "publishes a numeric text value",
    source: panel.replaceAll('"idle"', "0").replaceAll('"busy"', "1"),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "follows an immutable display snapshot",
    source: panel
      .replace("  return <button", "  const shownPhase = phaseRef.current;\n  return <button")
      .replace(display, "{shownPhase}"),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "follows an actually invoked render helper",
    source: panel
      .replace(
        "  return <button",
        "  const renderStatus = () => <output>{phaseRef.current}</output>;\n  return <button",
      )
      .replace(display + "</button>", "{renderStatus()}</button>"),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "admits a terminal completion after an earlier publication",
    source: panel
      .replace(publication, publication + '\n    phaseRef.current = "done";\n    setPhase("done");')
      .replace(display, '{phaseRef.current === "done" ? <span>Finished</span> : null}'),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "admits an independent conditional render reset",
    source: panel
      .replace("StatusPanel = ()", "StatusPanel = ({ changed })")
      .replace("  const activate", '  if (changed) phaseRef.current = "idle";\n  const activate'),
    accepted: true,
    ruleReports: 0,
  },
  {
    name: "does not treat boolean children as visible text",
    source: panel.replaceAll('"idle"', "false").replaceAll('"busy"', "true"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "requires a matching publication value",
    source: panel.replace(publication, '    setPhase("idle");'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "requires a displayed ref",
    source: panel.replace(display, "Continue"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "ignores an unused rendering helper",
    source: panel
      .replace(
        "  return <button",
        "  const renderStatus = () => <output>{phaseRef.current}</output>;\n  return <button",
      )
      .replace(display + "</button>", "Continue</button>"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "requires ref mutation before publication",
    source: panel.replace(refWrite + "\n" + publication, publication + "\n" + refWrite),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects an opaque call between mutation and publication",
    source: panel
      .replace("StatusPanel = ()", "StatusPanel = ({ notify })")
      .replace(publication, "    notify();\n" + publication),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects an async suspension between paired operations",
    source: panel
      .replace("useCallback(() =>", "useCallback(async () =>")
      .replace(publication, "    await Promise.resolve();\n" + publication),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects escape of the mutable ref object",
    source: panel
      .replace("StatusPanel = ()", "StatusPanel = ({ expose })")
      .replace("  const activate", "  expose(phaseRef);\n  const activate"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects a ref object alias",
    source: panel
      .replace("  const activate", "  const alias = phaseRef;\n  const activate")
      .replace(refWrite, '    alias.current = "busy";'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects setter alias transport",
    source: panel
      .replace("  const activate", "  const notify = setPhase;\n  const activate")
      .replace(publication, '    notify("busy");'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines computed current access",
    source: panel.replaceAll("phaseRef.current", 'phaseRef["current"]'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines optional current access",
    source: panel.replace(display, "{phaseRef?.current}"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "requires a genuine React ref",
    source: panel.replace('useRef("idle")', '{ current: "idle" }'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects a shadowed ref factory",
    source: panel.replace("StatusPanel = ()", "StatusPanel = ({ useRef })"),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "declines object-valued publication",
    source: panel
      .replaceAll('"idle"', '({ status: "idle" })')
      .replaceAll('"busy"', '({ status: "busy" })'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects an unclassified ref write",
    source: panel.replace(
      "  const activate",
      "  phaseRef.current = readStatus();\n  const activate",
    ),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects an unpaired restore after publication",
    source: panel.replace(publication, publication + '\n    phaseRef.current = "idle";'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "requires a value distinct from the initial value",
    source: panel.replaceAll('"busy"', '"idle"'),
    accepted: false,
    ruleReports: 1,
  },
  {
    name: "rejects a batched publication followed by paired undo",
    source: panel.replace(
      publication,
      publication + '\n    phaseRef.current = "idle";\n    setPhase("idle");',
    ),
    accepted: false,
  },
  {
    name: "requires the terminal published value to reach the display",
    source: panel
      .replace(publication, publication + '\n    phaseRef.current = "done";\n    setPhase("done");')
      .replace(display, '{phaseRef.current === "busy" ? <span>Working</span> : null}'),
    accepted: false,
  },
  {
    name: "rejects unconditional render resets",
    source: panel.replace("  const activate", '  phaseRef.current = "idle";\n  const activate'),
    accepted: false,
  },
  {
    name: "rejects a reset controlled by the selected ref",
    source: panel.replace(
      "  const activate",
      '  const reset = phaseRef.current === "busy";\n  if (reset) phaseRef.current = "idle";\n  const activate',
    ),
    accepted: false,
  },
  {
    name: "does not confuse constructed but unused JSX with display",
    source: panel
      .replace(
        "  return <button",
        "  const unused = <output>{phaseRef.current}</output>;\n  return <button",
      )
      .replace(
        display + "</button>",
        '{phaseRef.current === "other" ? <span>Other</span> : null}</button>',
      ),
    accepted: false,
  },
  {
    name: "does not assume a custom component renders its children",
    source: panel
      .replace(
        "return <button onClick={activate}>",
        "return <Container><button onClick={activate}>",
      )
      .replace("</button>;", "</button></Container>;"),
    accepted: false,
  },
  {
    name: "does not assume a wrapper returns its argument",
    source: panel
      .replace("return <button", "return consume(<button")
      .replace("</button>;", "</button>);"),
    accepted: false,
  },
  {
    name: "rejects setter calls hidden in catch defaults",
    source: panel.replace(
      "  const activate",
      '  try { work(); } catch ({ ignored = setPhase("busy") }) {}\n  const activate',
    ),
    accepted: false,
  },
  {
    name: "rejects setter calls hidden in computed catch keys",
    source: panel.replace(
      "  const activate",
      '  try { work(); } catch ({ [setPhase("busy")]: ignored }) {}\n  const activate',
    ),
    accepted: false,
  },
  {
    name: "rejects setter calls hidden in runtime enums",
    source: panel.replace(
      "  const activate",
      '  enum RuntimeValue { Hidden = setPhase("busy") }\n  const activate',
    ),
    accepted: false,
  },
  {
    name: "rejects setter calls hidden in parameter properties",
    source: panel.replace(
      "  const activate",
      '  class RuntimeValue { constructor(public ignored = setPhase("busy")) {} }\n  const activate',
    ),
    accepted: false,
  },
  {
    name: "rejects writes hidden in assignment patterns",
    source: panel.replace(
      "  const activate",
      "  ({ ignored: phaseRef.current } = source);\n  const activate",
    ),
    accepted: false,
  },
  {
    name: "does not treat type-only hooks as runtime imports",
    source: panel.replace("useRef, useState", "useRef, type useState"),
    accepted: false,
  },
  {
    name: "rejects mutation of the runtime hook import",
    source: panel.replace(
      "export const StatusPanel",
      "useRef.current = otherFactory;\nexport const StatusPanel",
    ),
    accepted: false,
  },
  {
    name: "declines optional hook calls",
    source: panel.replace('useRef("idle")', 'useRef?.("idle")'),
    accepted: false,
  },
  {
    name: "declines extra hook arguments",
    source: panel.replace('useRef("idle")', 'useRef("idle", work())'),
    accepted: false,
  },
  {
    name: "declines spread setter arguments",
    source: panel.replace(publication, '    setPhase(...["busy"]);'),
    accepted: false,
  },
  {
    name: "does not treat a boolean children attribute as visible output",
    source: panel
      .replaceAll('"idle"', "false")
      .replaceAll('"busy"', "true")
      .replace(
        "<button onClick={activate}>{phaseRef.current}</button>",
        "<button onClick={activate} children={phaseRef.current} />",
      ),
    accepted: false,
  },
  {
    name: "does not treat special native attributes as display evidence",
    source: panel.replace(
      "<button onClick={activate}>{phaseRef.current}</button>",
      "<button onClick={activate} key={phaseRef.current}>Continue</button>",
    ),
    accepted: false,
  },
  {
    name: "declines a predicate masked by constant true",
    source: panel.replace(display, '{(phaseRef.current === "busy" || true) && <span>Ready</span>}'),
    accepted: false,
  },
  {
    name: "declines a predicate masked by constant false",
    source: panel.replace(
      display,
      '{(phaseRef.current === "busy" && false) && <span>Working</span>}',
    ),
    accepted: false,
  },
  {
    name: "declines a predicate masked by a readonly boolean alias",
    source: panel
      .replace("  return <button", "  const always = true;\n  return <button")
      .replace(display, '{(phaseRef.current === "busy" || always) && <span>Ready</span>}'),
    accepted: false,
  },
  {
    name: "requires the render helper result to be returned without an opaque consumer",
    source: panel
      .replace(
        "  return <button",
        "  const renderStatus = () => <output>{phaseRef.current}</output>;\n  return <button",
      )
      .replace(display + "</button>", "{ignore(renderStatus())}</button>"),
    accepted: false,
  },
  {
    name: "declines two JSX alternatives instead of assuming they differ",
    source: panel.replace(
      display,
      '{phaseRef.current === "busy" ? <span>Ready</span> : <span>Ready</span>}',
    ),
    accepted: false,
  },
  {
    name: "rejects a local restoration call after publication",
    source: panel
      .replace(
        "  const activate",
        '  const restore = () => { phaseRef.current = "idle"; setPhase("idle"); };\n  const activate',
      )
      .replace(publication, publication + "\n    restore();"),
    accepted: false,
  },
  {
    name: "rejects a getter read after publication",
    source: panel.replace(publication, publication + "\n    observer.value;"),
    accepted: false,
  },
  {
    name: "rejects a new operation after publication",
    source: panel.replace(publication, publication + "\n    new Observer();"),
    accepted: false,
  },
];

const notificationProbe = defineRule({
  id: "paired-ref-notification-probe",
  title: "Paired ref notification",
  severity: "warn",
  create: (context) => ({
    VariableDeclarator: (node) => {
      if (!isComponentAssignment(node) || !isFunctionLike(node.init)) return;
      for (const binding of collectUseStateBindings(node.init.body, context.scopes)) {
        if (hasPairedRenderRefNotification(binding, node.init.body, context))
          context.report({ node: binding.declarator, message: "paired ref notification" });
      }
    },
  }),
});

describe("paired render ref notification", () => {
  it.each(cases)("$name", ({ source, accepted, ruleReports }) => {
    const proof = runRule(notificationProbe, source);
    expect(proof.parseErrors).toEqual([]);
    expect(proof.diagnostics).toHaveLength(accepted ? 1 : 0);
    if (ruleReports !== undefined) {
      for (const rule of [
        rerenderStateOnlyInHandlers,
        {
          ...rerenderStateOnlyInHandlers,
          create: (context: RuleContext) =>
            wrapWithSemanticContext(rerenderStateOnlyInHandlers).create(context),
        },
      ]) {
        const result = runRule(rule, source);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(ruleReports);
      }
    }
  });
});
