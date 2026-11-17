import { describe, expect, it, vi } from "vite-plus/test";
import * as sourceParser from "../../utils/parse-source-file.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { webhookSignatureRisk } from "./webhook-signature-risk.js";
import {
  WEBHOOK_POSITION_PROOF_COUNTS,
  WEBHOOK_POSITION_PROOF_PARSE_CALL_COUNT,
  WEBHOOK_POSITION_PROOF_QUOTED_SLICE_BASE_COUNT,
  WEBHOOK_POSITION_PROOF_QUOTED_SLICES_PER_ENTRY,
  WEBHOOK_POSITION_PROOF_TEMPLATE_SLICES_PER_ENTRY,
  WEBHOOK_POSITION_PROOF_NESTED_SLICE_COUNT,
} from "../../../test-utils/webhook-position-proof/constants.js";

const shapes = [
  "quoted-prose-before-runtime",
  "template-quasis-and-runtime",
  "nested-call-source-spans",
];

describe("webhook entrypoint cold source views", () => {
  for (const shape of shapes) {
    for (const count of WEBHOOK_POSITION_PROOF_COUNTS) {
      it(`${shape} with ${count} entries`, () => {
        const declarations = Array.from({ length: count }, (_, entryIndex) =>
          shape === "quoted-prose-before-runtime"
            ? `const text${entryIndex}="webhookHandler prose ${entryIndex}";`
            : `const text${entryIndex}=\`webhookHandler prose \${webhookRoute(req)}\`;`,
        ).join("\n");
        let code = `const req={};\n${declarations}${shape === "quoted-prose-before-runtime" ? "\nwebhookRoute(req);" : ""}\n`;
        if (shape === "nested-call-source-spans")
          code = `const req={};\nconst output=${"wrap(".repeat(count)}"webhookHandler prose"${")".repeat(count)};\nwebhookRoute(req);\n`;
        const controlCode =
          shape === "template-quasis-and-runtime"
            ? code.replaceAll("${webhookRoute(req)}", "")
            : code.replace("\nwebhookRoute(req);", "");
        const file = {
          absolutePath: `/private/synthetic-entrypoints/server/webhooks/${shape}-${count}.js`,
          relativePath: `server/webhooks/${shape}-${count}.js`,
          content: code,
          isGeneratedBundle: false,
        };
        const expectedLocation = getLocationAtIndex(code, code.indexOf("webhookRoute"));
        const sourceParserSpy = vi.spyOn(sourceParser, "parseSourceText");
        const sourceSliceSpy = vi.spyOn(String.prototype, "slice");
        try {
          const findings = webhookSignatureRisk.scan?.(file);
          const sourceSliceCalls = sourceSliceSpy.mock.contexts.filter(
            (context) => String(context) === code,
          ).length;
          let sliceLimit = WEBHOOK_POSITION_PROOF_NESTED_SLICE_COUNT;
          if (shape === "quoted-prose-before-runtime")
            sliceLimit =
              count * WEBHOOK_POSITION_PROOF_QUOTED_SLICES_PER_ENTRY +
              WEBHOOK_POSITION_PROOF_QUOTED_SLICE_BASE_COUNT;
          else if (shape === "template-quasis-and-runtime")
            sliceLimit = count * WEBHOOK_POSITION_PROOF_TEMPLATE_SLICES_PER_ENTRY;
          expect(sourceParserSpy).toHaveBeenCalledTimes(WEBHOOK_POSITION_PROOF_PARSE_CALL_COUNT);
          expect(
            sourceParserSpy.mock.results.every(
              (result) => result.type === "return" && result.value !== null,
            ),
          ).toBe(true);
          expect(sourceSliceCalls).toBeLessThanOrEqual(sliceLimit);
          expect(findings).toEqual([
            {
              message: "Webhook handler code does not show an obvious signature verification step.",
              ...expectedLocation,
            },
          ]);
        } finally {
          sourceSliceSpy.mockRestore();
          sourceParserSpy.mockRestore();
        }
        expect(webhookSignatureRisk.scan?.({ ...file, content: controlCode })).toEqual([]);
      });
    }
  }
});
