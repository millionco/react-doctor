export const parseHelpCommandAliases = (helpOutput: string): string[] => {
  const commandsSection = helpOutput.match(/(?:^|\n)Commands:\n([\s\S]*?)(?:\n\n|$)/);
  if (commandsSection === null) return [];

  return commandsSection[1]
    .split("\n")
    .flatMap((line) => {
      const commandSignature = line.match(/^  (\S+)/)?.[1];
      if (commandSignature === undefined) return [];
      return commandSignature.split("|").map((commandName) => commandName.replace(/\[.*$/, ""));
    })
    .filter(Boolean);
};
