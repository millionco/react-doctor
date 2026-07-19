// rule: r3f-no-duplicate-primitive-object
import "@react-three/fiber";

export const Scene = ({ model }) => (
  <>
    <primitive object={model.scene} />
    <primitive object={model["scene"]} />
    {["left", "right"].map((side) => (
      <primitive key={side} object={model.preview} />
    ))}
  </>
);
