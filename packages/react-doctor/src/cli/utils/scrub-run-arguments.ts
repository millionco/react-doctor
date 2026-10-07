import { anonymizeText } from "@react-doctor/core";

export const scrubRunArguments = (argumentsList: ReadonlyArray<string>): string =>
  anonymizeText(
    argumentsList
      .map((argument) => argument.replace(/^((?:--[^=]+=)?)(?:https?|wss?):\/\/.+$/i, "$1<url>"))
      .join(" "),
  );
