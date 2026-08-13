const INLINE_ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

const SCRIPT_COMMAND_WRAPPERS = new Set(["cross-env", "cross-env-shell", "env"]);
const SCRIPT_COMMAND_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
const SCRIPT_PACKAGE_MANAGERS = new Set(["npm", "pnpm", "yarn"]);
const SCRIPT_PACKAGE_MANAGER_RUNNERS = new Set(["dlx", "exec"]);
const SCRIPT_COMMAND_SHELLS = new Set(["bash", "dash", "fish", "sh", "zsh"]);
const SCRIPT_NESTED_COMMAND_RUNNERS = new Set(["conc", "concurrently"]);
const SCRIPT_NESTED_COMMAND_OPTIONS_WITH_VALUES = new Set([
  "--default-input-target",
  "--hide",
  "--kill-signal",
  "--kill-timeout",
  "--max-processes",
  "--name-separator",
  "--names",
  "--prefix",
  "--prefix-colors",
  "--prefix-length",
  "--restart-after",
  "--restart-delay",
  "--restart-tries",
  "--shell",
  "--success",
  "--timestamp-format",
  "--timings-prefix",
  "-c",
  "-l",
  "-m",
  "-n",
  "-p",
  "-s",
  "-t",
]);
const SCRIPT_NESTED_COMMAND_OPTIONS = new Set(["--teardown"]);
const SCRIPT_NESTED_COMMAND_SHORT_OPTIONS_WITH_VALUES = new Set([
  "c",
  "l",
  "m",
  "n",
  "p",
  "s",
  "t",
]);
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

interface HeredocMarker {
  delimiter: string;
  shouldTrimLeadingTabs: boolean;
}

export interface ScriptInvocation {
  readonly binaryName: string;
  readonly argumentValues: ReadonlyArray<string>;
}

const collectHeredocMarkers = (line: string): HeredocMarker[] => {
  const markers: HeredocMarker[] = [];
  let quote = "";

  for (let characterIndex = 0; characterIndex < line.length; characterIndex++) {
    const character = line[characterIndex];
    if (quote) {
      if (character === "\\" && quote !== "'" && characterIndex + 1 < line.length) {
        characterIndex++;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "\\" && characterIndex + 1 < line.length) {
      characterIndex++;
      continue;
    }
    if (character !== "<" || line[characterIndex + 1] !== "<" || line[characterIndex + 2] === "<") {
      continue;
    }

    let markerIndex = characterIndex + 2;
    const shouldTrimLeadingTabs = line[markerIndex] === "-";
    if (shouldTrimLeadingTabs) markerIndex++;
    while (/\s/.test(line[markerIndex] ?? "")) markerIndex++;

    let delimiter = "";
    const delimiterQuote = line[markerIndex];
    if (delimiterQuote === '"' || delimiterQuote === "'") {
      markerIndex++;
      while (markerIndex < line.length && line[markerIndex] !== delimiterQuote) {
        if (line[markerIndex] === "\\" && delimiterQuote === '"' && markerIndex + 1 < line.length) {
          markerIndex++;
        }
        delimiter += line[markerIndex];
        markerIndex++;
      }
      if (line[markerIndex] === delimiterQuote) markerIndex++;
    } else {
      while (markerIndex < line.length && !/[\s;|&<>]/.test(line[markerIndex])) {
        if (line[markerIndex] === "\\" && markerIndex + 1 < line.length) markerIndex++;
        delimiter += line[markerIndex];
        markerIndex++;
      }
    }

    if (delimiter) markers.push({ delimiter, shouldTrimLeadingTabs });
    characterIndex = markerIndex - 1;
  }

  return markers;
};

const stripHeredocBodies = (command: string): string => {
  const retainedLines: string[] = [];
  const pendingMarkers: HeredocMarker[] = [];
  for (const line of command.split(/\r?\n/)) {
    const pendingMarker = pendingMarkers[0];
    if (pendingMarker) {
      const closingMarker = pendingMarker.shouldTrimLeadingTabs ? line.replace(/^\t+/, "") : line;
      if (closingMarker.trimEnd() === pendingMarker.delimiter) {
        pendingMarkers.shift();
      }
      continue;
    }
    retainedLines.push(line);
    pendingMarkers.push(...collectHeredocMarkers(line));
  }
  return retainedLines.join("\n");
};

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
    if (character === "\n" || character === "\r") {
      pushCurrentSegment();
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
        const escapedCharacter = segment[characterIndex];
        currentToken += ";|&".includes(escapedCharacter)
          ? `\\${escapedCharacter}`
          : escapedCharacter;
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
      const escapedCharacter = segment[characterIndex];
      currentToken += ";|&".includes(escapedCharacter) ? `\\${escapedCharacter}` : escapedCharacter;
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

const extractCommandSubstitutions = (command: string): string[] => {
  const substitutions: string[] = [];
  let quote = "";
  for (let characterIndex = 0; characterIndex < command.length; characterIndex++) {
    const character = command[characterIndex];
    if (character === "\\" && quote !== "'" && characterIndex + 1 < command.length) {
      characterIndex++;
      continue;
    }
    if (character === "'" && quote !== '"') {
      quote = quote === "'" ? "" : "'";
      continue;
    }
    if (character === '"' && quote !== "'") {
      quote = quote === '"' ? "" : '"';
      continue;
    }
    if (quote === "'" || character !== "$" || command[characterIndex + 1] !== "(") continue;

    const contentStart = characterIndex + 2;
    let nestedDepth = 1;
    let nestedQuote = "";
    for (let nestedIndex = contentStart; nestedIndex < command.length; nestedIndex++) {
      const nestedCharacter = command[nestedIndex];
      if (nestedCharacter === "\\" && nestedQuote !== "'" && nestedIndex + 1 < command.length) {
        nestedIndex++;
        continue;
      }
      if (nestedCharacter === "'" && nestedQuote !== '"') {
        nestedQuote = nestedQuote === "'" ? "" : "'";
        continue;
      }
      if (nestedCharacter === '"' && nestedQuote !== "'") {
        nestedQuote = nestedQuote === '"' ? "" : '"';
        continue;
      }
      if (nestedQuote) continue;
      if (nestedCharacter === "(") nestedDepth++;
      if (nestedCharacter !== ")") continue;
      nestedDepth--;
      if (nestedDepth !== 0) continue;
      substitutions.push(command.slice(contentStart, nestedIndex));
      characterIndex = nestedIndex;
      break;
    }
  }
  return substitutions;
};

const collectScriptInvocations = (command: string, invocations: ScriptInvocation[]): void => {
  for (const substitution of extractCommandSubstitutions(command)) {
    collectScriptInvocations(substitution, invocations);
  }
  for (const segment of splitShellCommand(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (tokens.length === 0) continue;

    const binaryIndex = findScriptBinaryIndex(tokens);
    if (binaryIndex >= tokens.length) continue;

    const usesCrossEnvShell = tokens
      .slice(0, binaryIndex)
      .some((token) => normalizeBinaryToken(token) === "cross-env-shell");
    if (usesCrossEnvShell) {
      collectScriptInvocations(tokens.slice(binaryIndex).join(" "), invocations);
      continue;
    }

    const binaryName = normalizeBinaryToken(tokens[binaryIndex]);
    const shellCommand = extractShellCommand(tokens, binaryIndex);
    if (shellCommand) {
      collectScriptInvocations(shellCommand, invocations);
    } else if (!SCRIPT_COMMAND_SHELLS.has(binaryName) && binaryName) {
      invocations.push({ binaryName, argumentValues: tokens.slice(binaryIndex + 1) });
    }

    if (SCRIPT_NESTED_COMMAND_RUNNERS.has(binaryName)) {
      for (let argumentIndex = binaryIndex + 1; argumentIndex < tokens.length; argumentIndex++) {
        const argumentValue = tokens[argumentIndex];
        const optionName = argumentValue.split("=", 1)[0];
        if (argumentValue.startsWith("-")) {
          if (SCRIPT_NESTED_COMMAND_OPTIONS.has(optionName)) {
            const commandValue = argumentValue.includes("=")
              ? argumentValue.slice(argumentValue.indexOf("=") + 1)
              : tokens[++argumentIndex];
            if (commandValue) collectScriptInvocations(commandValue, invocations);
            continue;
          }
          if (
            (SCRIPT_NESTED_COMMAND_OPTIONS_WITH_VALUES.has(optionName) ||
              (optionName.startsWith("-") &&
                !optionName.startsWith("--") &&
                SCRIPT_NESTED_COMMAND_SHORT_OPTIONS_WITH_VALUES.has(optionName.at(-1) ?? ""))) &&
            !argumentValue.includes("=")
          ) {
            argumentIndex++;
          }
          continue;
        }
        collectScriptInvocations(argumentValue, invocations);
      }
    }

    const execCommand = extractExecCommand(tokens, binaryIndex + 1);
    if (execCommand) collectScriptInvocations(execCommand, invocations);
  }
};

export const extractScriptInvocations = (command: string): ScriptInvocation[] => {
  const invocations: ScriptInvocation[] = [];
  collectScriptInvocations(stripHeredocBodies(command), invocations);
  return invocations;
};

export const extractScriptBinaryNames = (command: string): string[] => {
  const binaryNames = new Set(
    extractScriptInvocations(command).map((invocation) => invocation.binaryName),
  );
  return [...binaryNames];
};
