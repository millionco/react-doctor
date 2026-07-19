import { useThree } from "@react-three/fiber";

export const CameraZoom = () => useThree((state) => state.camera.zoom);
