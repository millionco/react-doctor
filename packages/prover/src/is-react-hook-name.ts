export const isReactHookName = (name: string): boolean =>
  name === "use" || /^use[A-Z0-9]/.test(name);
