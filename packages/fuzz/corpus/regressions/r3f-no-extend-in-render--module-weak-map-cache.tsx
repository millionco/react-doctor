// rule: r3f-no-extend-in-render
// weakness: library-idiom
// source: RDE pmndrs/react-postprocessing@90d10d59 src/util.tsx
import { extend } from "@react-three/fiber";

const components = new WeakMap();

export const wrap = (effect) =>
  function Effect() {
    let Component = components.get(effect);
    if (!Component) {
      const key = `effect-${effect.name}`;
      extend({ [key]: effect });
      components.set(effect, (Component = key));
    }
    return <Component />;
  };
