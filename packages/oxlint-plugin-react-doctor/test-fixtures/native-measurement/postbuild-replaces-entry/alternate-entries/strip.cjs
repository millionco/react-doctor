const React = require("react");

module.exports = function AlternativeStrip({ index }) {
  return React.createElement("div", { style: { width: 320 + Math.abs(index) } }, "Alternate strip");
};
