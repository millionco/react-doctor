import { ENTERPRISE_CONTACT_URL } from "@react-doctor/core";

const ENTERPRISE_CONTACT_HINT = `Want something custom to your company? Contact us at ${ENTERPRISE_CONTACT_URL}.`;

export const buildNoScoreMessage = (isScoreDisabled: boolean): string => {
  const reason = isScoreDisabled
    ? "Score disabled by --no-score."
    : "Score unavailable (could not reach the score API).";

  return `${reason} ${ENTERPRISE_CONTACT_HINT}`;
};
