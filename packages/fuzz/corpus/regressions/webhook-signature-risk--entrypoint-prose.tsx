// rule: webhook-signature-risk
// weakness: entrypoint-source-position
// source: independent synthetic source position control
// verdict: pass
export const renderSource = () => "const payload = req.body;";
console.error("Could not write webhookHandler output");
