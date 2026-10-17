// rule: rn-prefer-expo-image
// verdict: pass
// weakness: cross-file
// source: independent synthetic imported asset-map regression
// file-path: corpus/regressions/rn-imported-bundled-image-map/static-map.tsx
import { Image } from "react-native";
import { artworkMap } from "./artwork-map";
export const BundledArtwork = () => <Image source={artworkMap.banner} />;
