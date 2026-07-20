const UPPERCASE_TECHNICAL_TOKEN_PATTERN = /^[A-Z0-9][A-Z0-9_.:/-]*$/;
const TECHNICAL_TOKEN_PATTERN = /^[A-Za-z0-9]+(?:[-_./:][A-Za-z0-9]+)+$/;

export const isTechnicalLabelText = (text: string): boolean => {
  if (UPPERCASE_TECHNICAL_TOKEN_PATTERN.test(text)) return true;
  const terminalSegments = text.split(/\s+—\s+/).filter(Boolean);
  return (
    terminalSegments.length > 1 &&
    terminalSegments.every(
      (segment) =>
        /^[a-z0-9]+$/.test(segment) ||
        UPPERCASE_TECHNICAL_TOKEN_PATTERN.test(segment) ||
        TECHNICAL_TOKEN_PATTERN.test(segment),
    )
  );
};
