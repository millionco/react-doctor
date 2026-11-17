// rule: rn-prefer-expo-image
// verdict: pass
// weakness: cross-file
// source: independent synthetic imported asset-map regression
// file-path: corpus/regressions/rn-imported-bundled-image-map/merged-bindings.tsx
import { Image } from "react-native";
import { artworkMap } from "./artwork-map";
interface artworkMap {}
export const MergedBundledMap = () => <Image source={artworkMap.banner} />;
