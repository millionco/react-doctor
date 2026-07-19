// rule: r3f-no-fresh-portal-container
import { createPortal } from "@react-three/fiber";
import { Scene } from "three";

export const Overlay = ({ child }) => createPortal(child, new Scene().add(child));
