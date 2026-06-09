import { prompts } from "./prompts.js";

const UPGRADE_YES_CHOICE = "upgrade-yes";
const UPGRADE_NO_CHOICE = "upgrade-no";

export type ActionUpgradePromptOutcome = "yes" | "no" | "cancel";

// The single canonical "upgrade this repo's workflow to the action's new major
// (`@v2`)?" prompt, shared by the `install` onboarding and the post-scan agent
// handoff so both surfaces ask it identically. Two choices only — a "no"
// doubles as "don't ask again" (persisted by the caller). Cancel (Esc /
// Ctrl-C) maps to "cancel" so a stray keypress neither bumps the workflow nor
// permanently suppresses the offer. The `prompt` arg is injectable for tests;
// production callers use the default real prompt.
export const askUpgradeActionVersion = async (
  prompt: typeof prompts = prompts,
): Promise<ActionUpgradePromptOutcome> => {
  const { upgradeChoice } = await prompt<"upgradeChoice">(
    {
      type: "select",
      name: "upgradeChoice",
      message: "A new major of the React Doctor Action (v2) is out. Upgrade this repo's workflow?",
      hint: " ",
      choices: [
        {
          title: "Yes (recommended)",
          description: "Bump the workflow to millionco/react-doctor@v2",
          value: UPGRADE_YES_CHOICE,
        },
        {
          title: "No, thanks",
          description: "Keep @v1 — won't ask again for this repo",
          value: UPGRADE_NO_CHOICE,
        },
      ],
      initial: 0,
    },
    { onCancel: () => true },
  );

  if (upgradeChoice === undefined) return "cancel";
  return upgradeChoice === UPGRADE_YES_CHOICE ? "yes" : "no";
};
