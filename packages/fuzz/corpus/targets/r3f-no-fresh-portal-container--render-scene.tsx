// rule: r3f-no-fresh-portal-container
// source: R3F portal store identity contract and Maxime Heckel portal examples
import { createPortal } from "@react-three/fiber";
import { Scene } from "three";

export const FreshPortalScene = ({ enabled }) => createPortal(<mesh />, enabled ? {} : new Scene());
