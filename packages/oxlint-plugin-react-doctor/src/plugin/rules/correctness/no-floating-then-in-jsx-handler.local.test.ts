import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFloatingThenInJsxHandler } from "./no-floating-then-in-jsx-handler.js";

describe("readonly local floating then handlers", () => {
  it.each([
    {
      name: "readonly concise native handler",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "readonly block optional clipboard handler",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { navigator.clipboard?.writeText(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "earlier unknown spread overridden",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button {...props} onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "later statically unrelated spread",
      code: 'const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} {...{title: "Copy"}} />; };',
      count: 1,
    },
    {
      name: "transparent handler initializer",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = (() => Promise.resolve(value).then(onSuccess)) satisfies (() => void);  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "transparent selected reference",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={(handleClick as () => void)} />; };",
      count: 1,
    },
    {
      name: "void chain",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => void Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "terminal finally",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess).finally(onFinish);  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "handled rejection",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess).catch(onFailure);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "async handler",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = async () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "parameter handler",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = (event) => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "default parameter",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = (event = prepare()) => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "rest parameter",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = (...events) => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "function expression",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = function () { Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "generator expression",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = function* () { Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "mutable binding",
      code: "const CopyControl = ({ value, onSuccess }) => { let handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "var binding",
      code: "const CopyControl = ({ value, onSuccess }) => { var handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "factory output",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = createHandler();  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "alias initializer",
      code: "const CopyControl = ({ value, onSuccess }) => { const original = () => Promise.resolve(value).then(onSuccess); const handleClick = original;  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "member initializer",
      code: "const CopyControl = ({ value, onSuccess }) => { const handlers = {copy: () => Promise.resolve(value).then(onSuccess)}; const handleClick = handlers.copy;  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "bind initializer",
      code: "const CopyControl = ({ value, onSuccess }) => { const original = () => Promise.resolve(value).then(onSuccess); const handleClick = original.bind(null);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "destructured binding",
      code: "const CopyControl = ({ value, onSuccess }) => { const {handleClick} = {handleClick: () => Promise.resolve(value).then(onSuccess)};  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "extra body statement",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { prepare(); Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "if body",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { if (enabled) Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "try body",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { try { Promise.resolve(value).then(onSuccess); } finally {} };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "loop body",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { for (const entry of entries) Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "explicit return block",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => { return Promise.resolve(value).then(onSuccess); };  return <button onClick={handleClick} />; };",
      count: 1,
    },
    {
      name: "opaque transport",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); consume(handleClick); return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "alias escape",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); const alias = handleClick; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "array transport",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); const callbacks = [handleClick]; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "object transport",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); const callbacks = {handleClick}; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "direct assignment",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); handleClick = other; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "object pattern assignment",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); ({callback: handleClick} = other); return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "array pattern assignment",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); [handleClick] = other; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "loop assignment",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); for (handleClick of handlers) {} return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "property mutation",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); handleClick.extra = true; return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "reflective transport",
      code: 'const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess); Object.defineProperty(handleClick, "extra", {value:true}); return <button onClick={handleClick} />; };',
      count: 0,
    },
    {
      name: "multiple JSX sites",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <><button onClick={handleClick}/><button onClick={handleClick}/></>; };",
      count: 0,
    },
    {
      name: "recursive reference",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve().then(handleClick);  return <button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "later duplicate override",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} onClick={undefined} />; };",
      count: 0,
    },
    {
      name: "later known event spread",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} {...{onClick: undefined}} />; };",
      count: 0,
    },
    {
      name: "later unknown spread",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <button onClick={handleClick} {...props} />; };",
      count: 0,
    },
    {
      name: "custom consumer",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <CopyButton onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "custom element",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <copy-button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "unknown lowercase",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <copybutton onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "member consumer",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <UI.Button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "namespaced consumer",
      code: "const CopyControl = ({ value, onSuccess }) => { const handleClick = () => Promise.resolve(value).then(onSuccess);  return <ui:button onClick={handleClick} />; };",
      count: 0,
    },
    {
      name: "cross owner capture",
      code: "const CopyControl = () => { const handleClick = () => Promise.resolve(value).then(onSuccess); const Child = () => <button onClick={handleClick} />; return <Child/>; };",
      count: 0,
    },
    {
      name: "program binding",
      code: "const handleClick = () => Promise.resolve(value).then(onSuccess); const CopyControl = () => <button onClick={handleClick}/>;",
      count: 0,
    },
    {
      name: "nested block declaration",
      code: "const CopyControl = () => { if (enabled) { const handleClick = () => Promise.resolve(value).then(onSuccess); return <button onClick={handleClick}/>; } };",
      count: 0,
    },
    {
      name: "unresolved identifier",
      code: "const CopyControl = () => <button onClick={handleClick}/>;",
      count: 0,
    },
    {
      name: "imported identifier",
      code: 'import {handleClick} from "./handlers"; const CopyControl = () => <button onClick={handleClick}/>;',
      count: 0,
    },
    {
      name: "declaration after attribute",
      code: "const CopyControl = () => { const element = <button onClick={handleClick}/>; const handleClick = () => Promise.resolve(value).then(onSuccess); return element; };",
      count: 0,
    },
    {
      name: "shadowed same name resolves selected local",
      code: "const handleClick = other; const CopyControl = () => { const handleClick = () => Promise.resolve(value).then(onSuccess); return <button onClick={handleClick}/>; };",
      count: 1,
    },
    {
      name: "empty statements",
      code: "const CopyControl = () => {  const handleClick = () => { ; Promise.resolve().then(onSuccess); ; }; return <button onClick={handleClick}/>; };",
      count: 1,
    },
    {
      name: "literal prologue",
      code: 'const CopyControl = () => {  const handleClick = () => { "use strict"; 0; Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };',
      count: 1,
    },
    {
      name: "void literal prologue",
      code: "const CopyControl = () => {  const handleClick = () => { void 0; Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 1,
    },
    {
      name: "return with no-op prologue",
      code: "const CopyControl = () => {  const handleClick = () => { void 0; return Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 1,
    },
    {
      name: "bare undefined remains unsupported",
      code: "const CopyControl = () => {  const handleClick = () => { undefined; Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 0,
    },
    {
      name: "shadowed undefined remains unsupported",
      code: "const CopyControl = () => { const undefined = possiblyThrowingValue; const handleClick = () => { undefined; Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 0,
    },
    {
      name: "void call is not inert",
      code: "const CopyControl = () => {  const handleClick = () => { void prepare(); Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 0,
    },
    {
      name: "empty return unsupported",
      code: "const CopyControl = () => {  const handleClick = () => { return; }; return <button onClick={handleClick}/>; };",
      count: 0,
    },
    {
      name: "two retained expressions unsupported",
      code: "const CopyControl = () => {  const handleClick = () => { Promise.resolve().then(onSuccess); Promise.resolve().then(onSuccess); }; return <button onClick={handleClick}/>; };",
      count: 0,
    },
  ])("$name", ({ code, count }) => {
    const result = runRule(noFloatingThenInJsxHandler, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });
});
