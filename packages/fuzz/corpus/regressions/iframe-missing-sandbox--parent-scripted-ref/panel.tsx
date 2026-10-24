// rule: iframe-missing-sandbox
// verdict: pass
// weakness: control-flow
// source: synthetic
import { useRef } from "react";

export const ParentScriptedPreview = () => {
  const preview = useRef(null);
  const populate = () => {
    const content = preview.current?.contentWindow?.document;
    if (content) {
      content.open();
      content.write("<p>Parent-owned preview</p>");
      content.close();
    }
  };
  return <iframe ref={preview} onLoad={populate} title="Local preview" />;
};
