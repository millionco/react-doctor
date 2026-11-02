// rule: unsafe-json-in-html
// verdict: fail
// weakness: cross-sink-attribution
// source: independent synthetic regression
export const view = <div dangerouslySetInnerHTML={{ __html: "Ready" }} />;
export const next = <div dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }} />;
