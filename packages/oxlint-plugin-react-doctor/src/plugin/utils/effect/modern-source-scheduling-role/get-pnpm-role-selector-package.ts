export const getPnpmRoleSelectorPackage = (selector: string): string | null => {
  const match = selector.match(
    /^(@[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*|[a-z0-9][a-z0-9_.-]*)(?:@(.+))?$/,
  );
  if (!match || selector.includes("${")) return null;
  const version = match[2];
  if (
    version !== undefined &&
    !/^[a-z][a-z0-9_.-]*$/.test(version) &&
    !version.split("||").every((branch) => {
      const tokens = branch.trim().split(/\s+/);
      return (
        tokens.length > 0 &&
        tokens.every((token) =>
          /^(?:[~^=]|<=?|>=?)?(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}(?:-[a-zA-Z0-9.-]+)?$/.test(
            token,
          ),
        )
      );
    })
  )
    return null;
  return match[1] ?? null;
};
