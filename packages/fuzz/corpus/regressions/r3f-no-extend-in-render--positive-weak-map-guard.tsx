// rule: r3f-no-extend-in-render
// weakness: control-flow
// source: Cursor Bugbot review
import { extend } from "@react-three/fiber";

const components = new WeakMap();

export const wrap = (effect) =>
  function Effect() {
    let Component = components.get(effect);
    if (Component) {
      return <Component />;
    } else {
      const key = `effect-${effect.name}`;
      extend({ [key]: effect });
      components.set(effect, (Component = key));
    }
    return <Component />;
  };
