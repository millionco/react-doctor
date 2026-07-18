// rule: r3f-no-object-pointer-capture
import "@react-three/fiber";

const handlePointer = (event) => event.object.setPointerCapture(event.pointerId);

export const Scene = ({ props }) => <mesh onPointerDown={handlePointer} {...props} />;
