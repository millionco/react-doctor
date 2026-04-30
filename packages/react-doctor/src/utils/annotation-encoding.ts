// HACK: GitHub Actions workflow command syntax requires URL-encoding for property
// values (commas, equals, colons, newlines) and message bodies (newlines, percent).
// See https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions

export const encodeAnnotationProperty = (value: string): string =>
  value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");

export const encodeAnnotationMessage = (value: string): string =>
  value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
