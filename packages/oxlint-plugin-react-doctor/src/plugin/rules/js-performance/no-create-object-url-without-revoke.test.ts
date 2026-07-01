import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

describe("no-create-object-url-without-revoke", () => {
  it("flags an object URL assigned to an anchor href with no revoke", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const download = (blob) => {
         a.href = URL.createObjectURL(blob);
         a.download = 'README.md';
         a.click();
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded object URL stored into a variable and state", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImage = (data) => {
         const imageObjectUrl = data && URL.createObjectURL(data);
         setImgObjectUrl(imageObjectUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline per-render src object URL", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const Preview = ({ file }) => <img src={URL.createObjectURL(file)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct state setter argument", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onDrop = (blob) => { setUrl(URL.createObjectURL(blob)); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a returned object URL", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `function make(blob) { return URL.createObjectURL(blob); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the module revokes elsewhere", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const url = URL.createObjectURL(blob);
       img.src = url;
       URL.revokeObjectURL(url);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a page-lifetime worker src global", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the unguarded avatar preview stored in state", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onSelect = (file) => {
         const preview = URL.createObjectURL(file);
         setAvatar(preview);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in a demo file", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `export default () => <a href={URL.createObjectURL(blob)}>download</a>;`,
      { filename: "/src/demos/index.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when URL is a local binding, not the DOM global", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const URL = getPolyfill();
       a.href = URL.createObjectURL(blob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a bare discarded createObjectURL expression", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const warmup = (blob) => { URL.createObjectURL(blob); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
