// rule: iframe-missing-sandbox
// weakness: wrapper-transparency
// source: synthetic regression
const PreviewFrame = (props) => <iframe {...props} srcDoc="<p>preview</p>" />;
export const EmbeddedPreview = () => <PreviewFrame sandbox="" />;
