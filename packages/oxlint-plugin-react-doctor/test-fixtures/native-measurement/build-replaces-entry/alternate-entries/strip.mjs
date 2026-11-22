import React from "react";

export default function AlternativeStrip({ index }) {
  return React.createElement("div", { style: { width: 320 + Math.abs(index) } }, "Alternate strip");
}
