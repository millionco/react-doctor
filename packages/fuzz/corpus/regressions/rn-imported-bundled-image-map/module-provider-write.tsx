// rule: rn-prefer-expo-image
// verdict: fail
// weakness: cross-file
// source: independent synthetic imported asset-map regression
// file-path: corpus/regressions/rn-imported-bundled-image-map/module-provider-write.tsx
import { Image } from "react-native";
import { artworkMap } from "./artwork-map";
module.require("react-native").Image = externalImage;
export const ReplacedImageProvider = () => <Image source={artworkMap.banner} />;
