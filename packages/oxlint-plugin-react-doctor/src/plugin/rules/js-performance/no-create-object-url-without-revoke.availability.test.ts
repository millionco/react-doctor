import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

const preview = `import { useCallback, useEffect, useRef, useState } from "react";

export function AttachmentPreview({ blob }: { blob: Blob | null }) {
  const currentUrl = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const display = useCallback((next: string) => {
    if (currentUrl.current && currentUrl.current !== next && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(currentUrl.current);
    }
    currentUrl.current = next;
    setPreviewUrl(next);
  }, []);

  useEffect(() => {
    return () => {
      if (currentUrl.current && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const next = blob && URL.createObjectURL(blob);
    if (next) display(next);
  }, [blob, display]);

  return <img src={previewUrl ?? undefined} alt="Attachment preview" />;
}
`;

const availability = 'typeof URL.revokeObjectURL === "function"';
const allocation = `  useEffect(() => {
    const next = blob && URL.createObjectURL(blob);
    if (next) display(next);
  }, [blob, display]);
`;
const dispose = `  useEffect(() => {
    return () => {
      if (currentUrl.current && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = null;
      }
    };
  }, []);
`;
const renderPreview = '  return <img src={previewUrl ?? undefined} alt="Attachment preview" />;';

const cases: ReadonlyArray<{ name: string; source: string; reports: boolean }> = [
  {
    name: "accepts direct native availability checks when cleanup is registered first",
    source: preview,
    reports: false,
  },
  {
    name: "continues accepting unconditional native revocation",
    source: preview.replaceAll(` && ${availability}`, ""),
    reports: false,
  },
  {
    name: "reports a setup that throws before a later cleanup registration",
    source: preview.replace(
      `${dispose}\n${allocation}`,
      `${allocation.replace(
        "    if (next) display(next);",
        '    if (next) display(next);\n    throw new Error("setup failed");',
      )}\n${dispose}`,
    ),
    reports: true,
  },
  {
    name: "reports a guard on an unrelated native URL method",
    source: preview.replace(dispose, dispose.replace("URL.revokeObjectURL ===", "URL.parse ===")),
    reports: true,
  },
  {
    name: "reports the inverted method availability guard",
    source: preview.replace(dispose, dispose.replace("===", "!==")),
    reports: true,
  },
  {
    name: "reports a dynamic availability comparison",
    source: preview.replace(
      dispose,
      dispose.replace(availability, "typeof URL.revokeObjectURL === String(typeof null)"),
    ),
    reports: true,
  },
  {
    name: "reports an ambient URL namespace that escapes to an alias",
    source: preview.replace(
      renderPreview,
      `  const removeRevoker = () => {
    const runtimeUrl = URL;
    Reflect.deleteProperty(runtimeUrl, "revokeObjectURL");
  };
  return <button onClick={removeRevoker}>{previewUrl}</button>;`,
    ),
    reports: true,
  },
  {
    name: "reports URL capability reached through destructured browser realm objects",
    source: preview.replace(
      renderPreview,
      `  return <button onClick={(event) => {
    const { ownerDocument } = event.currentTarget;
    const { defaultView } = ownerDocument;
    if (!defaultView) return;
    const { URL: runtimeUrl } = defaultView;
    Reflect.deleteProperty(runtimeUrl, "revokeObjectURL");
  }}>{previewUrl}</button>;`,
    ),
    reports: true,
  },
  {
    name: "reports a named setup reused outside the effect",
    source: preview
      .replace(
        "({ blob }: { blob: Blob | null })",
        "({ blob, close }: { blob: Blob | null; close: () => void })",
      )
      .replace(
        allocation,
        `${allocation.replace("useEffect(()", "const refresh = useCallback(()")}  useEffect(refresh, [refresh]);\n`,
      )
      .replace(
        renderPreview,
        `  return <button onClick={() => {
    setTimeout(refresh, 500);
    close();
  }}>{previewUrl}</button>;`,
      ),
    reports: true,
  },
  {
    name: "reports allocation after an async setup boundary",
    source: preview.replace(
      allocation,
      allocation
        .replace("useEffect(()", "useEffect(async ()")
        .replace("    const next", "    await Promise.resolve();\n    const next"),
    ),
    reports: true,
  },
  {
    name: "reports a string timer that can remove the native revoker",
    source: preview.replace(
      allocation,
      `${allocation}  useEffect(() => {
    setTimeout("delete URL.revokeObjectURL", 0);
  }, []);
`,
    ),
    reports: true,
  },
  {
    name: "reports replacement-only cleanup with no unmount disposer",
    source: preview.replace(dispose, ""),
    reports: true,
  },
];

describe.each(["curated", "upstream"] as const)(
  "no-create-object-url-without-revoke availability in %s",
  (portedRuleMode) => {
    it.each(cases)("$name", ({ source, reports }) => {
      const result = runRule(noCreateObjectUrlWithoutRevoke, source, {
        filename: "fixture.tsx",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode } },
      });
      expect(result.parseErrors).toEqual([]);
      const creationLine =
        source.split("\n").findIndex((line) => line.includes("URL.createObjectURL(blob)")) + 1;
      expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual(
        reports ? [creationLine] : [],
      );
    });
  },
);
