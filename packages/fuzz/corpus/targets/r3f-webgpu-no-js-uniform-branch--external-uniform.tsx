import { useNodes } from "@react-three/fiber/webgpu";
import { uniform } from "three/tsl";

const mode = uniform(0);

export const useColorNode = () => useNodes(() => (mode.value ? red : blue));
