const INLINE_ENV_VAR_PATTERN = /^[A-Z_][A-Z0-9_]*=/;

const SCRIPT_COMMAND_WRAPPERS = new Set(["cross-env", "cross-env-shell", "env"]);
const SCRIPT_COMMAND_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
const SCRIPT_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const SCRIPT_PACKAGE_MANAGER_RUNNERS = new Set(["dlx", "exec"]);
const SCRIPT_COMMAND_SHELLS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const SCRIPT_OPTIONS_WITH_VALUES = new Set([
  "--call",
  "--chdir",
  "--cwd",
  "--dir",
  "--filter",
  "--package",
  "--prefix",
  "--split-string",
  "--unset",
  "--workspace",
  "-C",
  "-F",
  "-S",
  "-c",
  "-p",
  "-u",
]);

const splitShellCommand = (command: string): string[] => {
  const segments: string[] = [];
  let currentSegment = "";
  let quote = "";

  const pushCurrentSegment = (): void => {
    if (currentSegment.trim().length > 0) segments.push(currentSegment);
    currentSegment = "";
  };

  for (let characterIndex = 0; characterIndex < command.length; characterIndex++) {
    const character = command[characterIndex];
    if (quote) {
      currentSegment += character;
      if (character === "\\" && quote !== "'" && characterIndex + 1 < command.length) {
        characterIndex++;
        currentSegment += command[characterIndex];
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      currentSegment += character;
      continue;
    }
    if (character === "\\" && characterIndex + 1 < command.length) {
      currentSegment += character;
      characterIndex++;
      currentSegment += command[characterIndex];
      continue;
    }
    if (character === ";" || character === "|" || character === "&") {
      pushCurrentSegment();
      if (command[characterIndex + 1] === character) characterIndex++;
      continue;
    }
    currentSegment += character;
  }

  pushCurrentSegment();
  return segments;
};

const tokenizeShellSegment = (segment: string): string[] => {
  const tokens: string[] = [];
  let currentToken = "";
  let quote = "";

  const pushCurrentToken = (): void => {
    if (currentToken.length === 0) return;
    tokens.push(currentToken);
    currentToken = "";
  };

  for (let characterIndex = 0; characterIndex < segment.length; characterIndex++) {
    const character = segment[characterIndex];
    if (quote) {
      if (character === quote) {
        quote = "";
      } else if (character === "\\" && quote !== "'" && characterIndex + 1 < segment.length) {
        characterIndex++;
        currentToken += segment[characterIndex];
      } else {
        currentToken += character;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      pushCurrentToken();
      continue;
    }
    if (character === "\\" && characterIndex + 1 < segment.length) {
      characterIndex++;
      currentToken += segment[characterIndex];
      continue;
    }
    currentToken += character;
  }

  pushCurrentToken();
  return tokens;
};

const normalizeBinaryToken = (token: string | undefined): string =>
  (token?.trim().split(/\s+/, 1)[0] ?? "").replace(/^.*[\\/]/, "");

const skipScriptOptions = (tokens: string[], startIndex: number): number => {
  let tokenIndex = startIndex;
  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    if (token === "--") return tokenIndex + 1;
    if (!token.startsWith("-")) return tokenIndex;
    const optionName = token.split("=", 1)[0];
    tokenIndex += SCRIPT_OPTIONS_WITH_VALUES.has(optionName) && !token.includes("=") ? 2 : 1;
  }
  return tokenIndex;
};

const findScriptBinaryIndex = (tokens: string[]): number => {
  let tokenIndex = 0;
  while (tokenIndex < tokens.length) {
    while (tokenIndex < tokens.length && INLINE_ENV_VAR_PATTERN.test(tokens[tokenIndex])) {
      tokenIndex++;
    }

    const binaryName = normalizeBinaryToken(tokens[tokenIndex]);
    if (SCRIPT_COMMAND_RUNNERS.has(binaryName)) {
      tokenIndex = skipScriptOptions(tokens, tokenIndex + 1);
      continue;
    }
    if (SCRIPT_PACKAGE_MANAGERS.has(binaryName)) {
      const runnerIndex = skipScriptOptions(tokens, tokenIndex + 1);
      if (!SCRIPT_PACKAGE_MANAGER_RUNNERS.has(tokens[runnerIndex] ?? "")) return tokenIndex;
      tokenIndex = skipScriptOptions(tokens, runnerIndex + 1);
      continue;
    }
    if (!SCRIPT_COMMAND_WRAPPERS.has(binaryName)) return tokenIndex;
    tokenIndex = skipScriptOptions(tokens, tokenIndex + 1);
  }
  return tokenIndex;
};

const extractExecCommand = (tokens: string[], startIndex: number): string => {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (token === "--exec" || token === "-x") return tokens[tokenIndex + 1] ?? "";
    if (token.startsWith("--exec=") || token.startsWith("-x=")) {
      return token.slice(token.indexOf("=") + 1);
    }
  }
  return "";
};

const extractShellCommand = (tokens: string[], binaryIndex: number): string => {
  const binaryName = normalizeBinaryToken(tokens[binaryIndex]);
  if (!SCRIPT_COMMAND_SHELLS.has(binaryName)) return "";

  for (let tokenIndex = binaryIndex + 1; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex];
    if (
      token === "--command" ||
      token === "-c" ||
      (/^-[A-Za-z]+$/.test(token) && token.includes("c"))
    ) {
      return tokens[tokenIndex + 1] ?? "";
    }
  }
  return "";
};

const collectScriptBinaryNames = (command: string, binaryNames: Set<string>): void => {
  for (const segment of splitShellCommand(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (tokens.length === 0) continue;

    const binaryIndex = findScriptBinaryIndex(tokens);
    if (binaryIndex >= tokens.length) continue;

    const binaryName = normalizeBinaryToken(tokens[binaryIndex]);
    const shellCommand = extractShellCommand(tokens, binaryIndex);
    if (shellCommand) {
      collectScriptBinaryNames(shellCommand, binaryNames);
    } else if (!SCRIPT_COMMAND_SHELLS.has(binaryName) && binaryName) {
      binaryNames.add(binaryName);
    }

    const execCommand = extractExecCommand(tokens, binaryIndex + 1);
    if (execCommand) collectScriptBinaryNames(execCommand, binaryNames);
  }
};

export const extractScriptBinaryNames = (command: string): string[] => {
  const binaryNames = new Set<string>();
  collectScriptBinaryNames(command, binaryNames);
  return [...binaryNames];
};
