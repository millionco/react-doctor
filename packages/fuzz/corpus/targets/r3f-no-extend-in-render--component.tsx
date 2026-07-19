// rule: r3f-no-extend-in-render
import { extend } from "@react-three/fiber";

const Scene = () => {
  extend({ CustomObject });
  return <customObject />;
};

export default Scene;
