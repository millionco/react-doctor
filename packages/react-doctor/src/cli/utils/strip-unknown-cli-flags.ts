import { NODE_ARGUMENT_COUNT } from "./constants.js";

interface CliFlagSpec {
  readonly longOptionsWithoutValues: ReadonlySet<string>;
  readonly longOptionsWithRequiredValues: ReadonlySet<string>;
  readonly longOptionsWithOptionalValues: ReadonlySet<string>;
  readonly shortOptionsWithoutValues: ReadonlySet<string>;
  readonly shortOptionsWithRequiredValues: ReadonlySet<string>;
}

const ROOT_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set([
    "--color",
    "--dead-code",
    "--help",
    "--json",
    "--json-compact",
    "--lint",
    "--no-color",
    "--no-dead-code",
    "--no-lint",
    "--no-parallel",
    "--no-respect-inline-disables",
    "--no-score",
    "--no-telemetry",
    "--no-warnings",
    "--score",
    "--staged",
    "--verbose",
    "--version",
    "--warnings",
    "--yes",
  ]),
  longOptionsWithRequiredValues: new Set([
    "--base",
    "--category",
    "--changed-files-from",
    "--blocking",
    "--output-dir",
    "--fail-on",
    "--project",
    "--scope",
  ]),
  longOptionsWithOptionalValues: new Set(["--diff"]),
  shortOptionsWithoutValues: new Set(["-h", "-v", "-y"]),
  shortOptionsWithRequiredValues: new Set(),
};

const INSTALL_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set([
    "--agent-hooks",
    "--color",
    "--dry-run",
    "--help",
    "--no-color",
    "--yes",
  ]),
  longOptionsWithRequiredValues: new Set(["--cwd"]),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-h", "-y"]),
  shortOptionsWithRequiredValues: new Set(["-c"]),
};

const VERSION_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set(["--color", "--help", "--no-color"]),
  longOptionsWithRequiredValues: new Set(),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-h"]),
  shortOptionsWithRequiredValues: new Set(),
};

// Union of every flag across the `rules` subcommands (list / explain /
// set / enable / disable / category / ignore-tag / unignore-tag). The
// subcommand name and positionals (rule key, severity, tag, category)
// are non-flag tokens and pass through untouched; only the options here
// need to survive the pre-parse strip so Commander can route them.
const RULES_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set(["--color", "--configured", "--help", "--json", "--no-color"]),
  longOptionsWithRequiredValues: new Set([
    "--category",
    "--cwd",
    "--framework",
    "--severity",
    "--tag",
  ]),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-h"]),
  shortOptionsWithRequiredValues: new Set(["-c"]),
};

// `why <file:line>` takes a positional location (passed through untouched) plus
// the working-directory / project / color options.
const WHY_FLAG_SPEC: CliFlagSpec = {
  longOptionsWithoutValues: new Set(["--color", "--help", "--no-color"]),
  longOptionsWithRequiredValues: new Set(["--cwd", "--project"]),
  longOptionsWithOptionalValues: new Set(),
  shortOptionsWithoutValues: new Set(["-h"]),
  shortOptionsWithRequiredValues: new Set(["-c"]),
};

const COMMAND_FLAG_SPECS = new Map<string, CliFlagSpec>([
  ["install", INSTALL_FLAG_SPEC],
  ["setup", INSTALL_FLAG_SPEC],
  ["version", VERSION_FLAG_SPEC],
  ["rules", RULES_FLAG_SPEC],
  ["why", WHY_FLAG_SPEC],
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
