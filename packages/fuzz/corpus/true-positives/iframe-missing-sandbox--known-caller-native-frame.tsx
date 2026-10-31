// rule: iframe-missing-sandbox
// weakness: cross-file
// source: synthetic regression
export const EmbeddedPreview = () => <iframe srcDoc="<p>preview</p>" />;
