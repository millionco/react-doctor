import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlInRender } from "./no-create-object-url-in-render.js";

describe("no-create-object-url-in-render", () => {
  it("reports object URLs created directly or through render-phase initializers", () => {
    const result = runRule(
      noCreateObjectUrlInRender,
      `import { useMemo, useState } from "react";
       const Preview = ({ data }) => {
         const directUrl = URL.createObjectURL(data);
         const memoUrl = useMemo(() => data ? URL.createObjectURL(data) : undefined, [data]);
         const [initialUrl] = useState(() => URL.createObjectURL(data));
         const assertedUrl = (URL as any).createObjectURL(data);
         const nonNullUrl = URL!.createObjectURL(data);
         const computedUrl = URL["createObjectURL"](data);
         return <img src={memoUrl ?? directUrl ?? initialUrl ?? assertedUrl ?? nonNullUrl ?? computedUrl} />;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(6);
  });

  it("allows effect and event lifecycles", () => {
    const result = runRule(
      noCreateObjectUrlInRender,
      `import { useEffect } from "react";
       const Preview = ({ data }) => {
         useEffect(() => {
           const objectUrl = URL.createObjectURL(data);
           return () => URL.revokeObjectURL(objectUrl);
         }, [data]);
         const download = () => {
           const objectUrl = URL.createObjectURL(data);
           URL.revokeObjectURL(objectUrl);
         };
         return <button onClick={download}>Download</button>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores shadowed URL objects and non-React helpers", () => {
    const result = runRule(
      noCreateObjectUrlInRender,
      `const format = (data) => URL.createObjectURL(data);
       const Preview = ({ URL, data }) => <img src={URL.createObjectURL(data)} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores dynamic computed members", () => {
    const result = runRule(
      noCreateObjectUrlInRender,
      `const Preview = ({ data, method }) => <img src={URL[method](data)} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a static template-literal member", () => {
    const result = runRule(
      noCreateObjectUrlInRender,
      "const Preview = ({ data }) => <img src={URL[`createObjectURL`](data)} />;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
