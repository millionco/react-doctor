import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../utils/rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { isCurrentContextRecordRetirement } from "./utils/is-current-context-record-retirement.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const certificateProbe: Rule = {
  id: "current-context-record-retirement-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (isCurrentContextRecordRetirement(node, context))
        context.report({ node, message: "current-context record retirement" });
    },
  }),
};

const baseSource =
  'import { useEffect, useState } from "react";\nexport const TokenNotice = ({ activeToken, respond }) => {\n  const currentToken = activeToken;\n  const [delivery, setDelivery] = useState(null);\n  useEffect(() => {\n    setDelivery(previous => previous && previous.token !== currentToken ? null : previous);\n  }, [currentToken]);\n  const send = async () => {\n    setDelivery(previous => ({ token: currentToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));\n    try {\n      const result = await respond();\n      setDelivery(previous => {\n        if (previous?.token !== currentToken) return previous;\n        if (result.ok) return null;\n        return { token: currentToken, pending: false, error: result.message };\n      });\n    } catch (error) {\n      setDelivery(previous => {\n        if (previous?.token !== currentToken) return previous;\n        return { token: currentToken, pending: false, error: String(error) };\n      });\n    }\n  };\n  const isCurrent = delivery?.token === currentToken;\n  const currentError = isCurrent ? delivery?.error : undefined;\n  return <section><button onClick={send}>Send</button>{currentError ? <p role="alert">{currentError}</p> : null}</section>;\n};\n';

const cases = [
  { name: "closed stamped record and current payload mask", source: baseSource, certificate: true },
  {
    name: "renamed record stamp and local pair",
    source: baseSource
      .replace(/\btoken\b/g, "marker")
      .replaceAll("delivery", "notice")
      .replaceAll("setDelivery", "setNotice"),
    certificate: true,
  },
  {
    name: "context may be undefined without exposing comparison boolean",
    source: baseSource.replace(
      "  const currentToken = activeToken;",
      "  const currentToken = undefined;",
    ),
    certificate: true,
  },
  {
    name: "exact undefined may use void zero",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const currentError = isCurrent ? delivery?.error : void 0;",
    ),
    certificate: true,
  },
  {
    name: "unmasked error is visible",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const currentError = delivery?.error;",
    ),
    certificate: false,
  },
  {
    name: "current boolean is itself visible",
    source: baseSource.replace(
      '  return <section><button onClick={send}>Send</button>{currentError ? <p role="alert">{currentError}</p> : null}</section>;',
      '  return <section aria-busy={isCurrent}><button onClick={send}>Send</button>{currentError ? <p role="alert">{currentError}</p> : null}</section>;',
    ),
    certificate: false,
  },
  {
    name: "logical false is not an undefined payload",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const currentError = isCurrent && delivery?.error;",
    ),
    certificate: false,
  },
  {
    name: "null mismatch changes after undefined context",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const currentError = isCurrent ? delivery?.error : null;",
    ),
    certificate: false,
  },
  {
    name: "shadowed undefined is not neutral",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      '  const undefined = "shadow";\n  const isCurrent = delivery?.token === currentToken;',
    ),
    certificate: false,
  },
  {
    name: "wrong stamp mask",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  const isCurrent = delivery?.otherToken === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "different current-context binding",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  const otherToken = activeToken;\n  const isCurrent = delivery?.token === otherToken;",
    ),
    certificate: false,
  },
  {
    name: "mutable current context",
    source: baseSource.replace(
      "  const currentToken = activeToken;",
      "  let currentToken = activeToken;",
    ),
    certificate: false,
  },
  {
    name: "ambient current context is not a local runtime snapshot",
    source: baseSource.replace(
      "  const currentToken = activeToken;",
      "  declare const currentToken: unknown;",
    ),
    certificate: false,
  },
  {
    name: "direct parameter context is outside first grammar",
    source: baseSource
      .replace("  const currentToken = activeToken;\n", "")
      .replaceAll("currentToken", "activeToken"),
    certificate: false,
  },
  {
    name: "raw state record reaches opaque child",
    source: baseSource.replace(
      '  return <section><button onClick={send}>Send</button>{currentError ? <p role="alert">{currentError}</p> : null}</section>;',
      '  return <section><Opaque record={delivery} /><button onClick={send}>Send</button>{currentError ? <p role="alert">{currentError}</p> : null}</section>;',
    ),
    certificate: false,
  },
  {
    name: "raw record identity reaches effect deps",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  useEffect(() => report(delivery), [delivery]);\n  const isCurrent = delivery?.token === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "state alias is not admitted",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const alias = delivery;\n  const currentError = isCurrent ? alias?.error : undefined;",
    ),
    certificate: false,
  },
  {
    name: "setter alias is not admitted",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  const alias = setDelivery;\n  alias(null);\n  const isCurrent = delivery?.token === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "setter escapes to arbitrary consumer",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  register(setDelivery);\n  const isCurrent = delivery?.token === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "external record writer",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  const importRecord = value => setDelivery(value);\n  const isCurrent = delivery?.token === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "spread record writer",
    source: baseSource.replace(
      "    setDelivery(previous => ({ token: currentToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
      "    setDelivery(previous => ({ token: currentToken, ...activeToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
    ),
    certificate: false,
  },
  {
    name: "record accessor writer",
    source: baseSource.replace(
      "    setDelivery(previous => ({ token: currentToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
      "    setDelivery(previous => ({ get token() { return currentToken; }, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
    ),
    certificate: false,
  },
  {
    name: "record prototype initializer",
    source: baseSource.replace(
      "    setDelivery(previous => ({ token: currentToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
      "    setDelivery(previous => ({ __proto__: activeToken, token: currentToken, pending: true, error: previous?.token === currentToken ? previous.error : undefined }));",
    ),
    certificate: false,
  },
  {
    name: "previous record mutation",
    source: baseSource.replace(
      "        return { token: currentToken, pending: false, error: result.message };",
      "        previous.token = currentToken;\n        return { token: currentToken, pending: false, error: result.message };",
    ),
    certificate: false,
  },
  {
    name: "matching record payload rewrite",
    source: baseSource.replace(
      "    setDelivery(previous => previous && previous.token !== currentToken ? null : previous);",
      "    setDelivery(previous => previous && previous.token !== currentToken ? null : { token: currentToken, error: undefined });",
    ),
    certificate: false,
  },
  {
    name: "clear matching record too",
    source: baseSource.replace(
      "    setDelivery(previous => previous && previous.token !== currentToken ? null : previous);",
      "    setDelivery(previous => previous ? null : previous);",
    ),
    certificate: false,
  },
  {
    name: "selected updater async",
    source: baseSource.replace(
      "    setDelivery(previous => previous && previous.token !== currentToken ? null : previous);",
      "    setDelivery(async previous => previous && previous.token !== currentToken ? null : previous);",
    ),
    certificate: false,
  },
  {
    name: "extra effect execution",
    source: baseSource.replace(
      "  }, [currentToken]);",
      "    report(currentToken);\n  }, [currentToken]);",
    ),
    certificate: false,
  },
  {
    name: "different effect dependency",
    source: baseSource.replace("  }, [currentToken]);", "  }, [activeToken]);"),
    certificate: false,
  },
  {
    name: "nullable stamp comparison not selected",
    source: baseSource.replace(
      "  const isCurrent = delivery?.token === currentToken;",
      "  const isCurrent = delivery && delivery.token === currentToken;",
    ),
    certificate: false,
  },
  {
    name: "payload read without optional access",
    source: baseSource.replace(
      "  const currentError = isCurrent ? delivery?.error : undefined;",
      "  const currentError = isCurrent ? delivery.error : undefined;",
    ),
    certificate: false,
  },
  {
    name: "type-only state import",
    source: baseSource.replace(
      'import { useEffect, useState } from "react";',
      'import { useEffect, type useState } from "react";',
    ),
    certificate: false,
  },
  {
    name: "foreign hook provider",
    source: baseSource.replace(
      'import { useEffect, useState } from "react";',
      'import { useEffect, useState } from "custom-hooks";',
    ),
    certificate: false,
  },
  {
    name: "source jsx provider pragma",
    source: baseSource.replace(
      'import { useEffect, useState } from "react";',
      '/** @jsxImportSource custom-runtime */\nimport { useEffect, useState } from "react";',
    ),
    certificate: false,
  },
];

describe("current-context record retirement", () => {
  it.each(cases)("$name", (fixture) => {
    const proof = runRule(certificateProbe, fixture.source, {
      filename: "/synthetic/current-context-record.tsx",
    });
    expect(proof.parseErrors).toEqual([]);
    expect(proof.diagnostics.length > 0).toBe(fixture.certificate);
  });

  it("exempts only the current payload-masked retirement", () => {
    const [fixture] = cases;
    if (!fixture) throw new Error("Missing current-context fixture");
    const result = runRule(noAdjustStateOnPropChange, fixture.source, {
      filename: "/synthetic/current-context-record.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains the ordinary unmasked stale error warning", () => {
    const fixture = cases.find((candidate) => candidate.name === "unmasked error is visible");
    if (!fixture) throw new Error("Missing unmasked fixture");
    const result = runRule(noAdjustStateOnPropChange, fixture.source, {
      filename: "/synthetic/current-context-record.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
