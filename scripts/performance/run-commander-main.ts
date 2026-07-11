import { CommanderError } from "commander";

export const runCommanderMain = (main: () => void): void => {
  try {
    main();
  } catch (error) {
    if (error instanceof CommanderError && error.code === "commander.helpDisplayed") return;
    throw error;
  }
};
