interface CliFlagSpec {
  readonly longOptionsWithoutValues: ReadonlySet<string>;
  readonly longOptionsWithRequiredValues: ReadonlySet<string>;
  readonly longOptionsWithOptionalValues: ReadonlySet<string>;
  readonly shortOptionsWithoutValues: ReadonlySet<string>;
  readonly shortOptionsWithRequiredValues: ReadonlySet<string>;
}

const NODE_ARGUMENT_COUNT = 2;

const ROOT_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set([
    "--annotations",
    "--dead-code",
    "--full",
    "--help",
    "--json",
    "--json-compact",
    "--lint",
    "--no-dead-code",
    "--no-lint",
    "--no-respect-inline-disables",
    "--no-score",
    "--no-warnings",
    "--pr-comment",
    "--respect-inline-disables",
    "--score",
    "--staged",
    "--verbose",
    "--version",
    "--warnings",
    "--yes",
  ]),
  longOptionsWithRequiredValues: new Set([
    "--changed-files-from",
    "--explain",
    "--fail-on",
    "--project",
    "--why",
  ]),
  longOptionsWithOptionalValues: new Set(["--diff", "--experimental-parallel"]),
  shortOptionsWithoutValues: new Set(["-h", "-v", "-y"]),
  shortOptionsWithRequiredValues: new Set(),
};

const INSTALL_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set(["--agent-hooks", "--dry-run", "--help", "--yes"]),
  longOptionsWithRequiredValues: new Set(["--cwd"]),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-h", "-y"]),
  shortOptionsWithRequiredValues: new Set(["-c"]),
};

const DEBUG_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set(["--daemon", "--help", "--json"]),
  longOptionsWithRequiredValues: new Set(["--host", "--log-path", "--port", "--session-id"]),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-d", "-h"]),
  shortOptionsWithRequiredValues: new Set(["-H", "-l", "-p", "-s"]),
};

const COMMAND_FLAG_SPECS = new Map<string, CliFlagSpec>([
  ["install", INSTALL_FLAG_SPEC],
  ["setup", INSTALL_FLAG_SPEC],
  ["debug", DEBUG_FLAG_SPEC],
]);

const isFlagLike = (argument: string): boolean => argument.startsWith("-") && argument !== "-";

const getLongOptionName = (argument: string): string => {
  const equalsIndex = argument.indexOf("=");
  return equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
};

const hasInlineOptionValue = (argument: string): boolean => argument.includes("=");

const shouldConsumeNextArgument = (
  argument: string,
  nextArgument: string | undefined,
  flagSpec: CliFlagSpec,
): boolean => {
  if (argument.startsWith("--")) {
    const optionName = getLongOptionName(argument);
    if (hasInlineOptionValue(argument)) return false;
    if (flagSpec.longOptionsWithRequiredValues.has(optionName)) return nextArgument !== undefined;
    return (
      flagSpec.longOptionsWithOptionalValues.has(optionName) &&
      nextArgument !== undefined &&
      !isFlagLike(nextArgument)
    );
  }
  return flagSpec.shortOptionsWithRequiredValues.has(argument) && nextArgument !== undefined;
};

const isKnownFlag = (argument: string, flagSpec: CliFlagSpec): boolean => {
  if (argument.startsWith("--")) {
    const optionName = getLongOptionName(argument);
    return (
      flagSpec.longOptionsWithoutValues.has(optionName) ||
      flagSpec.longOptionsWithRequiredValues.has(optionName) ||
      flagSpec.longOptionsWithOptionalValues.has(optionName)
    );
  }
  return (
    flagSpec.shortOptionsWithoutValues.has(argument) ||
    flagSpec.shortOptionsWithRequiredValues.has(argument)
  );
};

const findCommandIndex = (userArguments: ReadonlyArray<string>): number | null => {
  for (let argumentIndex = 0; argumentIndex < userArguments.length; argumentIndex += 1) {
    const argument = userArguments[argumentIndex];
    if (argument === "--") return null;
    if (!isFlagLike(argument)) {
      return COMMAND_FLAG_SPECS.has(argument) ? argumentIndex : null;
    }
    if (shouldConsumeNextArgument(argument, userArguments[argumentIndex + 1], ROOT_FLAG_SPEC)) {
      argumentIndex += 1;
    }
  }
  return null;
};

const stripUnknownFlags = (
  userArguments: ReadonlyArray<string>,
  flagSpec: CliFlagSpec,
): string[] => {
  const sanitizedArguments: string[] = [];
  for (let argumentIndex = 0; argumentIndex < userArguments.length; argumentIndex += 1) {
    const argument = userArguments[argumentIndex];
    if (argument === "--") {
      sanitizedArguments.push(...userArguments.slice(argumentIndex));
      return sanitizedArguments;
    }
    if (!isFlagLike(argument)) {
      sanitizedArguments.push(argument);
      continue;
    }
    if (!isKnownFlag(argument, flagSpec)) continue;
    sanitizedArguments.push(argument);
    if (shouldConsumeNextArgument(argument, userArguments[argumentIndex + 1], flagSpec)) {
      argumentIndex += 1;
      sanitizedArguments.push(userArguments[argumentIndex]);
    }
  }
  return sanitizedArguments;
};

export const stripUnknownCliFlags = (argv: ReadonlyArray<string>): string[] => {
  const nodeArguments = argv.slice(0, NODE_ARGUMENT_COUNT);
  const userArguments = argv.slice(NODE_ARGUMENT_COUNT);
  const commandIndex = findCommandIndex(userArguments);
  if (commandIndex === null) {
    return [...nodeArguments, ...stripUnknownFlags(userArguments, ROOT_FLAG_SPEC)];
  }
  const commandName = userArguments[commandIndex];
  const commandFlagSpec = COMMAND_FLAG_SPECS.get(commandName) ?? ROOT_FLAG_SPEC;
  return [
    ...nodeArguments,
    ...stripUnknownFlags(userArguments.slice(0, commandIndex), ROOT_FLAG_SPEC),
    commandName,
    ...stripUnknownFlags(userArguments.slice(commandIndex + 1), commandFlagSpec),
  ];
};
