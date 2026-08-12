const REACT_EMAIL_DEV_COMMAND_PATTERN = /(?:^|\s)email\s+dev(?:\s|$)/;
const REACT_EMAIL_DIRECTORY_OPTION_PATTERN = /(?:^|\s)(?:--dir|-d)(?:=|\s+)(["']?)([^\s"']+)\1/;

export const extractReactEmailTemplateDirectories = (scripts: ReadonlyArray<string>): string[] => {
  const directories = new Set<string>();
  for (const script of scripts) {
    if (!REACT_EMAIL_DEV_COMMAND_PATTERN.test(script)) continue;
    directories.add(REACT_EMAIL_DIRECTORY_OPTION_PATTERN.exec(script)?.[2] ?? "emails");
  }
  return [...directories];
};
