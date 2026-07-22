export const isThreeModuleSource = (moduleSource: string): boolean =>
  moduleSource === "three" || moduleSource === "three-stdlib" || moduleSource.startsWith("three/");
