// rule: jsx-props-no-spreading
// weakness: library-idiom
// source: independent synthetic closed CSF2 forwarding control
// verdict: pass
import "react";
import { PreviewPanel } from "synthetic-preview-panel";
const metadata = { component: PreviewPanel };
export default metadata;
const ForwardPreview = (properties) => <PreviewPanel {...properties} />;
export const BasicPreview = ForwardPreview.bind({});
BasicPreview.args = { label: "Preview" };
