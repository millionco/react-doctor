// rule: r3f-webgpu-no-js-uniform-branch
// weakness: provenance
// source: adversarial integration review
import { useNodes } from "@react-three/fiber/webgpu";

const mode = { value: 0 };

export const useColorNode = () => useNodes(() => (mode.value ? red : blue));
