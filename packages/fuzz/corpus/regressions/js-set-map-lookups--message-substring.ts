// rule: js-set-map-lookups
// weakness: name-heuristic
// source: GitHub issue #1701
// verdict: pass

const POSTGRES_CODE_MESSAGES = {
  "23505": "Duplicate record",
  "23503": "Missing related record",
};

export const translateError = (rawMessage, locale) => {
  for (const [code, friendlyMessage] of Object.entries(POSTGRES_CODE_MESSAGES)) {
    if (rawMessage.includes(code)) return `${friendlyMessage}:${locale}`;
  }
  return rawMessage;
};
