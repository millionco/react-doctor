const LOCAL_SCRIPT_FILE_REFERENCE_PATTERN =
  /^\s*(?:(?:bash|dash|fish|sh|zsh)\s+)?((?:\.{1,2}\/|[\w@-]+\/)[\w./@-]+)(?:\s|$)/;

export const extractLocalScriptFileReference = (command: string): string | undefined =>
  command.match(LOCAL_SCRIPT_FILE_REFERENCE_PATTERN)?.[1];
