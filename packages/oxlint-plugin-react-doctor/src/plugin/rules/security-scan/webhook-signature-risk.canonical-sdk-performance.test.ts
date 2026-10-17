import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import {
  SHOPIFY_DATA_REFERENCE_PASS_LIMIT,
  SHOPIFY_HEADER_PREFIX_PASS_LIMIT,
  SHOPIFY_WEBHOOK_WORK_COUNTS,
} from "../../../test-utils/shopify-webhook-proof/constants.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getClosedShopifyValidationHandler } from "./utils/get-closed-shopify-validation-handler.js";
import { hasClosedShopifyModule } from "./utils/has-closed-shopify-module.js";
import { isCanonicalShopifyClient } from "./utils/is-canonical-shopify-client.js";
import { webhookSignatureRisk } from "./webhook-signature-risk.js";

describe("canonical SDK webhook proof work", () => {
  for (const shape of ["provider-reused-data-alias", "handler-header-aliases"]) {
    for (const count of SHOPIFY_WEBHOOK_WORK_COUNTS) {
      it(`keeps ${shape} proof work linear across ${count} reads`, () => {
        const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shopify-proof-")));
        try {
          fs.mkdirSync(path.join(directory, "server/webhooks"), { recursive: true });
          const routePath = path.join(directory, "server/webhooks/route.js");
          const config =
            'apiKey:"synthetic-key",apiSecretKey:"synthetic-secret",scopes:SCOPES,hostName:"synthetic.invalid",apiVersion:"2025-01",isEmbeddedApp:true';
          const imports =
            'import {shopifyApi} from "@shopify/shopify-api";import "@shopify/shopify-api/adapters/node";';
          const provider =
            imports +
            'const selectedScope="read_products";const client=shopifyApi({' +
            config.replace("SCOPES", "[" + Array(count).fill("selectedScope").join(",") + "]") +
            "});export default client;";
          const headers = Array.from(
            { length: count },
            (_, index) => `const topic${index}=request.headers["x-topic-${index}"]||"";`,
          ).join("");
          const passive =
            "console.error({" +
            Array.from({ length: count }, (_, index) => `topic${index}`).join(",") +
            "});";
          const selectedHeaders = shape === "handler-header-aliases" ? headers : "";
          const selectedPassive = shape === "handler-header-aliases" ? passive : "";
          const handler = `const webhookHandler=async(request,response)=>{${selectedHeaders}try{const outcome=await client.webhooks.validate({rawBody:request.body,rawRequest:request,rawResponse:response});if(outcome.valid){}else{return response.status(400).send("rejected");}await applyPayload(outcome.topic,request.body);return response.status(200).send("done");}catch(failure){${selectedPassive}return response.status(500).send("failed");}};export default webhookHandler;`;
          const code =
            (shape === "provider-reused-data-alias"
              ? 'import client from "../client.js";'
              : imports +
                "const client=shopifyApi({" +
                config.replace("SCOPES", '["read_products"]') +
                "});") + handler;
          fs.writeFileSync(routePath, code);
          fs.writeFileSync(path.join(directory, "server/client.js"), provider);
          const parsed = parseFixture(shape === "provider-reused-data-alias" ? provider : code, {
            filename: "fixture.js",
          });
          expect(parsed.errors).toEqual([]);
          attachParentReferences(parsed.program);
          const scopes = analyzeScopes(parsed.program);
          const nodes: EsTreeNode[] = [];
          const symbols = new Set<SymbolDescriptor>();
          walkAst(parsed.program, (node) => {
            nodes.push(node);
            if (isNodeOfType(node, "Identifier")) {
              const symbol = scopes.symbolFor(node);
              if (symbol) symbols.add(symbol);
            }
          });
          let selectedScopeReferenceVisits = 0;
          let headerPrefixVisits = 0;
          for (const symbol of symbols) {
            Object.defineProperty(symbol, "references", {
              configurable: true,
              value: new Proxy(symbol.references, {
                get(target, property, receiver) {
                  if (
                    symbol.name === "selectedScope" &&
                    typeof property === "string" &&
                    /^\d+$/.test(property)
                  )
                    selectedScopeReferenceVisits += 1;
                  return Reflect.get(target, property, receiver);
                },
              }),
            });
          }
          if (shape === "handler-header-aliases") {
            const selectedHandler = nodes.find((node) =>
              isNodeOfType(node, "ArrowFunctionExpression"),
            );
            if (
              !isNodeOfType(selectedHandler, "ArrowFunctionExpression") ||
              !isNodeOfType(selectedHandler.body, "BlockStatement")
            )
              throw new Error("Missing synthetic handler");
            Object.defineProperty(selectedHandler.body, "body", {
              configurable: true,
              value: new Proxy(selectedHandler.body.body, {
                get(target, property, receiver) {
                  if (property === "slice")
                    return (start?: number, end?: number) =>
                      new Proxy(target.slice(start, end), {
                        get(sliceTarget, sliceProperty, sliceReceiver) {
                          if (typeof sliceProperty === "string" && /^\d+$/.test(sliceProperty))
                            headerPrefixVisits += 1;
                          return Reflect.get(sliceTarget, sliceProperty, sliceReceiver);
                        },
                      });
                  return Reflect.get(target, property, receiver);
                },
              }),
            });
          }
          expect(hasClosedShopifyModule(parsed.program, scopes)).toBe(true);
          if (shape === "provider-reused-data-alias") {
            if (!isNodeOfType(parsed.program, "Program"))
              throw new Error("Missing synthetic program");
            const selectedExport = parsed.program.body.find((node) =>
              isNodeOfType(node, "ExportDefaultDeclaration"),
            );
            if (
              !isNodeOfType(selectedExport, "ExportDefaultDeclaration") ||
              !isNodeOfType(selectedExport.declaration, "Identifier")
            )
              throw new Error("Missing synthetic export");
            const client = scopes.symbolFor(selectedExport.declaration);
            if (!client) throw new Error("Missing synthetic client");
            expect(isCanonicalShopifyClient(client, scopes, selectedExport.declaration)).toBe(true);
          } else {
            const selectedHandler = getClosedShopifyValidationHandler(parsed.program, scopes);
            if (!selectedHandler) throw new Error("Missing synthetic handler proof");
            expect(
              isCanonicalShopifyClient(selectedHandler.client, scopes, selectedHandler.clientRead),
            ).toBe(true);
          }
          expect(selectedScopeReferenceVisits).toBeLessThanOrEqual(
            count * SHOPIFY_DATA_REFERENCE_PASS_LIMIT,
          );
          expect(headerPrefixVisits).toBeLessThanOrEqual(count * SHOPIFY_HEADER_PREFIX_PASS_LIMIT);
          const file = {
            absolutePath: routePath,
            relativePath: "server/webhooks/route.js",
            content: code,
            isGeneratedBundle: false,
          };
          expect(webhookSignatureRisk.scan?.(file)).toHaveLength(0);
          expect(
            webhookSignatureRisk.scan?.({
              ...file,
              content: code.replace(
                "await applyPayload",
                'request.body="changed";await applyPayload',
              ),
            }),
          ).toHaveLength(1);
        } finally {
          fs.rmSync(directory, { recursive: true, force: true });
        }
      });
    }
  }
});
