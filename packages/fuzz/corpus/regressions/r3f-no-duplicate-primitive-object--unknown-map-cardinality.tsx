// rule: r3f-no-duplicate-primitive-object
import "@react-three/fiber";

export const Scene = ({ items, scene }) =>
  items.map((item) => <primitive key={item.id} object={scene} />);

export const PerItemScene = ({ items }) =>
  [items[0], items[1]].map((item) => <primitive key={item.id} object={item.scene} />);
