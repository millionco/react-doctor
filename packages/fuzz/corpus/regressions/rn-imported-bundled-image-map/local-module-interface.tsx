// rule: rn-prefer-expo-image
// verdict: pass
// weakness: cross-file
// source: independent synthetic imported asset-map regression
// file-path: corpus/regressions/rn-imported-bundled-image-map/local-module-interface.tsx
import { Image } from "react-native";
import { artworkMap } from "./artwork-map";
const module = { require: () => ({ Image: 1 }) };
interface module {}
module.require("react-native").Image = externalImage;
export const LocalModuleProvider = () => <Image source={artworkMap.banner} />;
