// rule: iframe-missing-sandbox
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/pull/2197
// verdict: pass
import React, { useRef } from "react";
export const Preview = () => {
  const frame = useRef(null);
  const open = () => {
    const container = document.querySelector("#preview");
    container.querySelector(".carrier > iframe").setAttribute("src", "https://media.example/video");
  };
  return (
    <div id="preview" onClickCapture={(event) => event.stopPropagation()}>
      <div className="carrier">
        <iframe ref={frame} />
      </div>
      <button onClick={open}>Open</button>
    </div>
  );
};
