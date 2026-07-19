// rule: r3f-cap-device-pixel-ratio
import { Canvas } from "@react-three/fiber";

export const Scene = () => <Canvas dpr={window.devicePixelRatio} />;
