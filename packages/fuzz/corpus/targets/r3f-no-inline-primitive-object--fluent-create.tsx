// rule: r3f-no-inline-primitive-object
import "@react-three/fiber";
import { Group } from "three";

export const Scene = ({ child, prototype }) => (
  <>
    <primitive object={new Group().add(child)} />
    <primitive object={Object.create(prototype)} />
  </>
);
