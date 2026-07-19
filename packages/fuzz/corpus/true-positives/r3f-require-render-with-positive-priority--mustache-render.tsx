// rule: r3f-require-render-with-positive-priority
// weakness: library-provenance
// source: second adversarial audit of the R3F rule candidate suite
import Mustache from "mustache";
import { useFrame } from "@react-three/fiber";

export const TemplateWork = ({ source, view }) => {
  useFrame(() => {
    Mustache.render(source, view);
  }, 1);
  return null;
};
