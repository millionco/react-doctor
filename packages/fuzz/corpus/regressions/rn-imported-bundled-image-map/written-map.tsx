// rule: rn-prefer-expo-image
// verdict: fail
// weakness: cross-file
// source: independent synthetic imported asset-map regression
// file-path: corpus/regressions/rn-imported-bundled-image-map/written-map.tsx
import { Image } from "react-native";
import { artworkMap } from "./artwork-map";
artworkMap.banner = externalArtwork;
export const BundledArtwork = () => <Image source={artworkMap.banner} />;
