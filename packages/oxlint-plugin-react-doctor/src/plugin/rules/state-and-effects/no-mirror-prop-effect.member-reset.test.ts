import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMirrorPropEffect } from "./no-mirror-prop-effect.js";

interface MirrorResetCase {
  name: string;
  code: string;
  expected: number;
}

const cases: MirrorResetCase[] = [
  {
    name: "distinct member",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "nested member",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.session.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "computed string member",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset["version"]]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "computed variable member",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset[key]]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "optional member",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset?.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "two separate members",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.version, settings.sequence]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "member on setter value",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, setDraft.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "separate member without local edits",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.version]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member reset beside legacy identifier reset",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.version, resetNonce]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "layout effect member reset",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useLayoutEffect(() => { setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "member reset returned setter",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { return setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "member reset discarded setter",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { void setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "member reset nested JSX readback",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, reset.version]); return <section><output>{draft}</output><button onClick={() => setDraft(0)}>Reset</button></section>; };',
    expected: 0,
  },
  {
    name: "same object separate property",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props, props.resetVersion]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "same object mirror plus separate property",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props, props.value, props.resetVersion]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "exact member duplicate is still a mirror",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props, props.value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "duplicate exact members stay mirrors",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props, props.value, props.value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "different notation conservatively separate",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props, props["value"]]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "pure identifier mirror",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "handler written mirror still reports",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "setter only extra dependency still reports",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, setDraft]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "literal dependency keeps legacy behavior",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, 1]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "unused call dependency keeps legacy behavior",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, readReset()]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "unused array dependency keeps legacy behavior",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, []]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "separate identifier reset remains exempt",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setDraft(value); }, [value, resetVersion]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "initial only seed remains exempt",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ initialValue, reset }) => { const [draft, setDraft] = useState(initialValue);  useEffect(() => { setDraft(initialValue); }, [initialValue]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "different transformed value does not mirror",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value.toUpperCase());  useEffect(() => { setDraft(value.toLowerCase()); }, [value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "matching transformed identifier mirror reports",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value.toUpperCase());  useEffect(() => { setDraft(value.toUpperCase()); }, [value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "nested member initializer exact extra retains warning",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value.current);  useEffect(() => { setDraft(props.value.current); }, [props, props.value.current]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "nested member separate reset suppresses",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value.current);  useEffect(() => { setDraft(props.value.current); }, [props, props.reset.current]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "canonical member-only dependency mirror",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props.value);  useEffect(() => { setDraft(props.value); }, [props.value]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "renamed native setter remains unsupported",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, changeDraft] = useState(value);  useEffect(() => { changeDraft(value); }, [value]); return <button onClick={() => changeDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "effect with two statements stays outside mirror grammar",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { notify(); setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "effect writing unrelated setter remains quiet",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  useEffect(() => { setOther(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "nested helper effect remains outside top-level grammar",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = ({ value, reset }) => { const [draft, setDraft] = useState(value);  const helper = () => useEffect(() => { setDraft(value); }, [value, reset.version]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 0,
  },
  {
    name: "computed same member matches structurally",
    code: 'import React, { useEffect, useLayoutEffect, useState } from "react"; const Panel = (props) => { const [draft, setDraft] = useState(props["value"]);  useEffect(() => { setDraft(props["value"]); }, [props, props["value"]]); return <button onClick={() => setDraft((previous) => previous + 1)}>{draft}</button>; };',
    expected: 1,
  },
  {
    name: "member-only default namespace hooks",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = React.useState(props.value); React.useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only namespace import hooks",
    code: 'import * as React from "react"; export const Panel = (props) => { const [draft, setDraft] = React.useState(props.value); React.useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only named import aliases",
    code: 'import React, { useState as useNativeState, useEffect as useNativeEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useNativeState(props.value); useNativeEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only unrelated member trigger",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, props.resetVersion]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unrelated member alone",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.resetVersion]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only computed access conservatively deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props["value"]); useEffect(() => { setDraft(props["value"]); }, [props["value"]]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only readonly type reference",
    code: 'import React, { useState, useEffect } from "react"; type Props = React.PropsWithChildren<{ value: string }>; export const Panel = (props: Props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only nonreact state import",
    code: 'import { useEffect } from "react"; import { useState } from "other-state"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only nonreact effect import",
    code: 'import { useState } from "react"; import { useEffect } from "other-effects"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unbound hooks unsupported",
    code: " export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };",
    expected: 0,
  },
  {
    name: "member-only type-only state import",
    code: 'import { useEffect } from "react"; import type { useState } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only type-only effect import",
    code: 'import { useState } from "react"; import type { useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only state namespace replacement",
    code: 'import React, { useState, useEffect } from "react"; React.useState = replacement; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only effect namespace replacement",
    code: 'import React, { useState, useEffect } from "react"; React.useEffect = replacement; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only named pattern assignment",
    code: 'import React, { useState, useEffect } from "react"; ({useState}=replacement); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only effect loop assignment",
    code: 'import React, { useState, useEffect } from "react"; for(useEffect of replacements){} export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only namespace escape",
    code: 'import React, { useState, useEffect } from "react"; expose(React); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only imported hook escape",
    code: 'import React, { useState, useEffect } from "react"; expose(useState); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only global React exposure",
    code: 'import React, { useState, useEffect } from "react"; window.React.useState = replacement; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only direct eval unsupported",
    code: 'import React, { useState, useEffect } from "react"; eval("replace provider"); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only Function exposure unsupported",
    code: 'import React, { useState, useEffect } from "react"; Function("return 0"); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only require exposure unsupported",
    code: 'import React, { useState, useEffect } from "react"; const load = require; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only builtin loader import unsupported",
    code: 'import React, { useState, useEffect } from "react"; import {createRequire} from "node:module"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only dynamic builtin import unsupported",
    code: 'import React, { useState, useEffect } from "react"; import("node:module"); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only constructor carrier unsupported",
    code: 'import React, { useState, useEffect } from "react"; const compile = (()=>{}).constructor; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only shadowed Function is distinct",
    code: 'import React, { useState, useEffect } from "react"; const Function = () => null; Function(); export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only effect callback extra statement remains quiet",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { notify(); setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only optional state call unsupported",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState?.(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only optional effect call unsupported",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect?.(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only layout effect",
    code: 'import React, { useState, useLayoutEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useLayoutEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only callback parameter shadows props",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect((props) => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only named callback shadows props",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(function props() { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only callback input unsupported",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect((unused) => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only async callback unsupported",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(async () => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only generator callback unsupported",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(function* () { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only computed runtime key deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props[key]); useEffect(() => { setDraft(props[key]); }, [props[key]]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only nested access deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value.current); useEffect(() => { setDraft(props.value.current); }, [props.value.current]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only anonymous function callback",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(function () { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only mutable state declaration deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { let [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only setter direct replacement deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); setDraft = replacement; useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only setter pattern replacement deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); [setDraft] = [replacement]; useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only props binding replacement deferred",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); props = replacement; useEffect(() => { setDraft(props.value); }, [props.value]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra call dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, readResetVersion()]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra array dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, []]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra object dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, {}]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra spread dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, ...resetVersions]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra conditional dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, ready ? firstReset : secondReset]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra hole dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, ,]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra binary dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, resetVersion + 1]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra literal dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, 1]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra function dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, () => resetVersion]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only unsupported extra wrapped identifier dependency",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, resetVersion as number]); return <output>{draft}</output>; };',
    expected: 0,
  },
  {
    name: "member-only trailing comma is not a hole",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value,]); return <output>{draft}</output>; };',
    expected: 1,
  },
  {
    name: "member-only extra identifier remains a separate trigger",
    code: 'import React, { useState, useEffect } from "react"; export const Panel = (props) => { const [draft, setDraft] = useState(props.value); useEffect(() => { setDraft(props.value); }, [props.value, resetVersion]); return <output>{draft}</output>; };',
    expected: 0,
  },
];

describe("no-mirror-prop-effect member dependencies", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noMirrorPropEffect, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
