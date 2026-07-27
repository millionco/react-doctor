export interface CliHelpInvocation {
  readonly name: string;
  readonly arguments: ReadonlyArray<string>;
}

export const CLI_HELP_INVOCATIONS: ReadonlyArray<CliHelpInvocation> = [
  { name: "root", arguments: ["--help"] },
  { name: "design", arguments: ["design", "--help"] },
  { name: "why", arguments: ["why", "--help"] },
  { name: "install", arguments: ["install", "--help"] },
  { name: "setup-alias", arguments: ["setup", "--help"] },
  { name: "ci", arguments: ["ci", "--help"] },
  { name: "ci-install", arguments: ["ci", "install", "--help"] },
  { name: "ci-config", arguments: ["ci", "config", "--help"] },
  { name: "ci-upgrade", arguments: ["ci", "upgrade", "--help"] },
  { name: "ci-help-alias", arguments: ["ci", "help"] },
  { name: "version", arguments: ["version", "--help"] },
  { name: "rules", arguments: ["rules", "--help"] },
  { name: "rules-list", arguments: ["rules", "list", "--help"] },
  { name: "rules-explain", arguments: ["rules", "explain", "--help"] },
  { name: "rules-set", arguments: ["rules", "set", "--help"] },
  { name: "rules-enable", arguments: ["rules", "enable", "--help"] },
  { name: "rules-disable", arguments: ["rules", "disable", "--help"] },
  { name: "rules-category", arguments: ["rules", "category", "--help"] },
  { name: "rules-ignore-tag", arguments: ["rules", "ignore-tag", "--help"] },
  { name: "rules-unignore-tag", arguments: ["rules", "unignore-tag", "--help"] },
  { name: "rules-help-alias", arguments: ["rules", "help"] },
  { name: "experimental-lsp", arguments: ["experimental-lsp", "--help"] },
  { name: "experimental-tui", arguments: ["experimental-tui", "--help"] },
  { name: "help-alias", arguments: ["help"] },
  { name: "help-install-alias", arguments: ["help", "install"] },
  { name: "help-setup-alias", arguments: ["help", "setup"] },
  { name: "legacy-diff-flag", arguments: ["--diff=false", "--help"] },
  { name: "legacy-fail-on-flag", arguments: ["--fail-on=none", "--help"] },
];
