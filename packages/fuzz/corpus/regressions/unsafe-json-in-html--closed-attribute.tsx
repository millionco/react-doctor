// rule: unsafe-json-in-html
// verdict: pass
// weakness: cross-sink-attribution
// source: independent synthetic regression
export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;
export const serialized = JSON.stringify(payload);
