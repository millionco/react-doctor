import { extractScriptInvocations } from "./extract-script-binary-names.js";

const extractDirectoryArgument = (argumentValues: ReadonlyArray<string>): string | undefined => {
  for (let argumentIndex = 1; argumentIndex < argumentValues.length; argumentIndex++) {
    const argumentValue = argumentValues[argumentIndex];
    if (argumentValue.startsWith("--dir=")) return argumentValue.slice("--dir=".length);
    if (argumentValue.startsWith("-d=")) return argumentValue.slice("-d=".length);
    if (argumentValue === "--dir" || argumentValue === "-d") {
      return argumentValues[argumentIndex + 1];
    }
  }
  return undefined;
};

export const extractReactEmailTemplateDirectories = (scripts: ReadonlyArray<string>): string[] => {
  const directories = new Set<string>();
  for (const script of scripts) {
    for (const invocation of extractScriptInvocations(script)) {
      if (invocation.binaryName !== "email" || invocation.argumentValues[0] !== "dev") continue;
      directories.add(extractDirectoryArgument(invocation.argumentValues) ?? "emails");
    }
  }
  return [...directories];
};
