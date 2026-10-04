import { MINIMUM_FOG_PARAMETER } from "../constants.js";

interface FogParameterConfiguration {
  readonly constructorName: "Fog" | "FogExp2";
  readonly density?: number;
  readonly far?: number;
  readonly near?: number;
}

export const getInvalidFogParameter = (configuration: FogParameterConfiguration): string | null => {
  if (configuration.constructorName === "FogExp2") {
    return configuration.density !== undefined && configuration.density < MINIMUM_FOG_PARAMETER
      ? "density must be non-negative"
      : null;
  }
  if (configuration.near !== undefined && configuration.near < MINIMUM_FOG_PARAMETER) {
    return "near must be non-negative";
  }
  return configuration.near !== undefined &&
    configuration.far !== undefined &&
    configuration.far <= configuration.near
    ? "far must be greater than near"
    : null;
};
