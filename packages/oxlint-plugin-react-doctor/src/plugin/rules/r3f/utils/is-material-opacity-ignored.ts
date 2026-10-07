export interface StaticMaterialTransparencyConfiguration {
  alphaHash: boolean | null | undefined;
  alphaTest: number | null | undefined;
  opacity: number | null | undefined;
  transparent: boolean | null | undefined;
}

export const isMaterialOpacityIgnored = (
  configuration: StaticMaterialTransparencyConfiguration,
): boolean => {
  if (
    configuration.opacity === null ||
    configuration.opacity === undefined ||
    configuration.opacity < 0 ||
    configuration.opacity >= 1 ||
    configuration.transparent === null ||
    configuration.alphaHash === null ||
    configuration.alphaTest === null
  ) {
    return false;
  }
  return (
    configuration.transparent !== true &&
    configuration.alphaHash !== true &&
    !(configuration.alphaTest !== undefined && configuration.alphaTest > 0)
  );
};
