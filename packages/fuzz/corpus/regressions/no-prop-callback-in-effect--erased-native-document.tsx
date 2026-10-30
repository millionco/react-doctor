// rule: no-prop-callback-in-effect
// verdict: pass
// weakness: name-heuristic
// source: synthetic
interface document {}
import * as React from "react";
export const Example = (props) => {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const handleMove = (event) => {
    setPosition({ x: event.clientX, y: event.clientY });
  };
  function bindEvent(remove) {
    let method = "addEventListener";
    if (remove) method = "removeEventListener";
    document[method]("mousemove", handleMove, false);
  }
  React.useEffect(() => {
    bindEvent();
    return () => bindEvent(true);
  }, []);
  React.useEffect(() => {
    props.onChange(position.x, position.y);
  }, [position]);
  return null;
};
