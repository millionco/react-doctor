import os from "node:os";

const HOME_DIRECTORY = os.homedir();

const USER_HOME_PATTERNS: ReadonlyArray<RegExp> = [
  /[A-Za-z]:[\\/]Users[\\/][^\\/]+/gi,
  /(?:\/Users\/|\/home\/)[^/\\]+/gi,
];

export const scrubSensitivePaths = (text: string): string => {
  let scrubbed = text;
  if (HOME_DIRECTORY.length > 1) {
    scrubbed = scrubbed.split(HOME_DIRECTORY).join("~");
  }
  for (const pattern of USER_HOME_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, "~");
  }
  return scrubbed;
};
