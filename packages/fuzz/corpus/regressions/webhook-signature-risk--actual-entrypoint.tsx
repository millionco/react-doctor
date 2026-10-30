// rule: webhook-signature-risk
// weakness: entrypoint-source-position
// source: independent synthetic source position control
// verdict: fail
export const webhookHandler = (req: { body: unknown }) => req.body;
