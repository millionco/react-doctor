import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Diagnostic as LiveDiagnostic } from "@react-doctor/core/schemas";
import { formatDiagnosticSite } from "../../utils/format-diagnostic-site.js";
import { severityVariant } from "../lib/severity-variants.js";

export interface ScanningProps {
  readonly progressText: string | null;
  readonly liveCount: number;
  readonly recent: ReadonlyArray<LiveDiagnostic>;
}

export const Scanning = ({ progressText, liveCount, recent }: ScanningProps) => {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
        <Text> {progressText ?? "Scanning…"}</Text>
        {liveCount > 0 ? (
          <Text dimColor>
            {"  ·  "}
            {liveCount} found
          </Text>
        ) : null}
      </Text>
      {recent.map((diagnostic) => {
        const variant = severityVariant(diagnostic.severity === "error" ? "error" : "warning");
        const location = formatDiagnosticSite(diagnostic);
        return (
          <Text
            key={`${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column}:${diagnostic.plugin}:${diagnostic.rule}`}
            wrap="truncate-end"
          >
            {"  "}
            <Text color={variant.color}>{variant.icon}</Text>
            <Text> {diagnostic.title ?? `${diagnostic.plugin}/${diagnostic.rule}`}</Text>
            <Text dimColor>
              {"  "}
              {location}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
};
