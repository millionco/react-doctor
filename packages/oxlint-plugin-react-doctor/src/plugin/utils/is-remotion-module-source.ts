export const isRemotionModuleSource = (moduleSource: string): boolean =>
  moduleSource === "remotion" || moduleSource.startsWith("@remotion/");
