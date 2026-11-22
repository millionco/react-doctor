const React = require("react");
module.exports = function AlternateRail({ wrapper, content, offset }) {
  React.useLayoutEffect(() => {
    if (wrapper.current)
      wrapper.current.getBoundingClientRect = () => new DOMRect(0, 0, Math.abs(offset), 40);
  }, [wrapper, offset]);
  return React.createElement(
    "div",
    { ref: wrapper },
    React.createElement("nav", { ref: content }, offset),
  );
};
