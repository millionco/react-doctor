import { Box, render, Text, useInput } from "ink";
import { RUNTIME_SCAN_MAX_STRING_LENGTH } from "../runtime-scan/constants.js";
import { sanitizeRuntimeUrl } from "../runtime-scan/sanitize-runtime-url.js";
import { isPrintableInput } from "../utils/is-printable-input.js";
import { unrefStdin } from "../utils/unref-stdin.js";
import { useExitOnCtrlC } from "./hooks/use-exit-on-ctrl-c.js";
import { useState } from "./react-runtime.js";
import { registerMountedTuiRenderer } from "./register-mounted-tui-renderer.js";

export interface RuntimeScanUrlPromptProps {
  readonly onSubmit: (url: string | null) => void;
}

export const RuntimeScanUrlPrompt = ({ onSubmit }: RuntimeScanUrlPromptProps) => {
  const [url, setUrl] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  useExitOnCtrlC();

  const updateUrl = (nextUrl: string): void => {
    setUrl(nextUrl.slice(0, RUNTIME_SCAN_MAX_STRING_LENGTH));
    setValidationMessage(null);
  };

  useInput((input, key) => {
    if (key.escape) return onSubmit(null);
    if (key.backspace || key.delete) return updateUrl(url.slice(0, -1));
    if (key.ctrl && input === "u") return updateUrl("");
    if (key.return) {
      const trimmedUrl = url.trim();
      try {
        sanitizeRuntimeUrl(trimmedUrl);
        onSubmit(trimmedUrl);
      } catch {
        setValidationMessage("Enter an absolute URL starting with http:// or https://.");
      }
      return;
    }
    if (isPrintableInput(input) && !key.ctrl && !key.meta) updateUrl(url + input);
  });

  return (
    <Box flexDirection="column">
      <Text bold>Record runtime performance</Text>
      <Text dimColor>Enter the URL of your running React app.</Text>
      <Text wrap="truncate-end">
        <Text color="cyan">{"› "}</Text>
        {url}
        <Text inverse> </Text>
      </Text>
      {validationMessage === null ? null : <Text color="red">{validationMessage}</Text>}
      <Text dimColor>Enter start · Esc cancel · Ctrl+U clear</Text>
    </Box>
  );
};

export const promptRuntimeScanUrl = (): Promise<string | null> =>
  new Promise((resolve) => {
    let disposeRenderer = (): void => {};
    const submitUrl = (url: string | null): void => {
      disposeRenderer();
      unrefStdin();
      resolve(url);
    };
    const instance = render(<RuntimeScanUrlPrompt onSubmit={submitUrl} />, {
      alternateScreen: true,
      exitOnCtrlC: false,
      stdin: process.stdin,
      stdout: process.stderr,
    });
    disposeRenderer = registerMountedTuiRenderer(instance);
  });
