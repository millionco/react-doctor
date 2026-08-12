const PREVIEW_REGISTRY_NAME_PATTERN =
  /<PreviewComponents\b[^>]*\bregistryName\s*=\s*(["'])([A-Za-z0-9][A-Za-z0-9._-]*)\1[^>]*>/g;

export const extractPreviewRegistryNamesFromMdx = (sourceText: string): string[] => {
  const renderedLines: string[] = [];
  let fenceMarker = "";
  let fenceLength = 0;
  let isInHtmlComment = false;

  for (const line of sourceText.split("\n")) {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const nextFenceMarker = fenceMatch[1][0];
      if (!fenceMarker) {
        fenceMarker = nextFenceMarker;
        fenceLength = fenceMatch[1].length;
      } else if (
        nextFenceMarker === fenceMarker &&
        fenceMatch[1].length >= fenceLength &&
        fenceMatch[2].trim().length === 0
      ) {
        fenceMarker = "";
        fenceLength = 0;
      }
      continue;
    }
    if (fenceMarker) continue;

    let renderedLine = "";
    let remainingLine = line;
    while (remainingLine.length > 0) {
      if (isInHtmlComment) {
        const commentEnd = remainingLine.indexOf("-->");
        if (commentEnd === -1) break;
        isInHtmlComment = false;
        remainingLine = remainingLine.slice(commentEnd + 3);
        continue;
      }
      const commentStart = remainingLine.indexOf("<!--");
      if (commentStart === -1) {
        renderedLine += remainingLine;
        break;
      }
      renderedLine += remainingLine.slice(0, commentStart);
      isInHtmlComment = true;
      remainingLine = remainingLine.slice(commentStart + 4);
    }
    renderedLines.push(renderedLine);
  }

  const registryNames = new Set<string>();
  const renderedSource = renderedLines.join("\n");
  let registryMatch: RegExpExecArray | null;
  while ((registryMatch = PREVIEW_REGISTRY_NAME_PATTERN.exec(renderedSource)) !== null) {
    registryNames.add(registryMatch[2]);
  }
  return [...registryNames];
};
