import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFloatingThenInJsxHandler } from "./no-floating-then-in-jsx-handler.js";

describe("no-floating-then-in-jsx-handler", () => {
  it("flags a concise-arrow floating then", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => doThing().then(handleResult)} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a block-body floating then", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <form onSubmit={() => { saveForm().then(() => setOpen(false)); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member-call then chain", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <input onChange={() => api.update(x).then(refetch)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a logout().then() navigation handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <a onClick={() => logout().then(() => (window.location.href = '/'))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an async handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={async () => { await save(); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an explicit void fire-and-forget", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => void save().then(refetch)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with a .catch", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(refetch).catch(reportError)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a two-argument then with onRejected", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(onOk, onErr)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a trailing .finally", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(r).finally(done)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a returned promise chain", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { return save().then(refetch); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a handler with no .then token", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => setOpen(true)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier handler reference", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then inside a nested callback within the handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { items.forEach((x) => save(x).then(done)); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-handler prop", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <Comp render={() => load().then(show)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
