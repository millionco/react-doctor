import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

const managedPreview = (
  work: string,
  cleanup = `() => {
  cancelled = true;
  if (owned) URL.revokeObjectURL(owned);
}`,
) => `
  import { useEffect, useState } from "react";
  function Preview({ read, enabled, files, other }) {
    const [href, setHref] = useState(null);
    useEffect(() => {
      let cancelled = false;
      let owned = null;
      void (async () => {
        await read();
        ${work}
      })();
      return ${cleanup};
    }, [read, enabled, files, other]);
    return <img src={href ?? undefined} alt="" />;
  }
`;

const createPrivateUrl = `
  if (enabled) {
    const blob = new Blob(["preview"]);
    if (cancelled) return;
    owned = URL.createObjectURL(blob);
    setHref(owned);
  }
`;

describe("private Blob URLs allocated after an async cancellation check", () => {
  it("recognizes the cleanup for a single private Blob URL", () => {
    const result = runRule(noCreateObjectUrlWithoutRevoke, managedPreview(createPrivateUrl));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    createPrivateUrl.replace("if (cancelled) return;", ""),
    createPrivateUrl.replace('new Blob(["preview"])', "other"),
    createPrivateUrl.replace("setHref(owned);", "owned = other; setHref(owned);"),
    `for (const file of files) { ${createPrivateUrl} }`,
  ])("keeps warning when allocation can outlive its cleanup", (work) => {
    const result = runRule(noCreateObjectUrlWithoutRevoke, managedPreview(work));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "() => { cancelled = true; if (other) URL.revokeObjectURL(other); }",
    "function* () { cancelled = true; if (owned) URL.revokeObjectURL(owned); }",
    "(unused = other()) => { cancelled = true; if (owned) URL.revokeObjectURL(owned); }",
    "() => { if (owned) URL.revokeObjectURL(owned); }",
  ])("keeps warning when the returned cleanup does not own the URL and guard", (cleanup) => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      managedPreview(createPrivateUrl, cleanup),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
