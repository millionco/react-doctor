// verdict: pass
// rule: webhook-signature-risk
// file-path: server/webhooks/route.js
// weakness: library-idiom
// source: synthetic canonical SDK webhook result gate
import { shopifyApi } from "@shopify/shopify-api";
import "@shopify/shopify-api/adapters/node";
const client = shopifyApi({
  apiKey: process.env.SYNTHETIC_API_KEY,
  apiSecretKey: process.env.SYNTHETIC_API_SECRET,
  scopes: ["read_products"],
  hostName: "synthetic.invalid",
  apiVersion: "2025-01",
  isEmbeddedApp: true,
});
const webhookHandler = async (request, response) => {
  try {
    const outcome = await client.webhooks.validate({
      rawBody: request.body,
      rawRequest: request,
      rawResponse: response,
    });
    if (outcome.valid) {
    } else {
      return response.status(400).send("rejected");
    }
    await applyPayload(outcome.topic, request.body);
    return response.status(200).send("done");
  } catch {
    return response.status(500).send("failed");
  }
};
export default webhookHandler;
