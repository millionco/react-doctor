import { Box, render, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import {
  RUNTIME_SCAN_MAX_STRING_LENGTH,
  RUNTIME_SCAN_PROMPT_MAX_WIDTH_COLUMNS,
  RUNTIME_SCAN_PROMPT_PADDING_COLUMNS,
  RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS,
} from "../runtime-scan/constants.js";
import {
  detectLocalRuntimeUrls,
  type RuntimeScanLocalUrlSuggestion,
} from "../runtime-scan/detect-local-runtime-urls.js";
import { sanitizeRuntimeUrl } from "../runtime-scan/sanitize-runtime-url.js";
import { isPrintableInput } from "../utils/is-printable-input.js";
import { terminalSymbols } from "../utils/terminal-symbols.js";
import { unrefStdin } from "../utils/unref-stdin.js";
import { useExitOnCtrlC } from "./hooks/use-exit-on-ctrl-c.js";
import { useStdoutDimensions } from "./hooks/use-stdout-dimensions.js";
import { useEffect, useState } from "./react-runtime.js";
import { registerMountedTuiRenderer } from "./register-mounted-tui-renderer.js";

export interface RuntimeScanUrlPromptProps {
  readonly discoverLocalUrls?: () => Promise<ReadonlyArray<RuntimeScanLocalUrlSuggestion>>;
  readonly onSubmit: (url: string | null) => void;
}

type RuntimeScanUrlPromptMode = "select" | "custom";

export const RuntimeScanUrlPrompt = ({
  discoverLocalUrls = detectLocalRuntimeUrls,
  onSubmit,
}: RuntimeScanUrlPromptProps) => {
  const [mode, setMode] = useState<RuntimeScanUrlPromptMode>("select");
  const [suggestions, setSuggestions] = useState<ReadonlyArray<RuntimeScanLocalUrlSuggestion>>([]);
  const [isDetecting, setIsDetecting] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [url, setUrl] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const { columns: terminalColumns, rows: terminalRows } = useStdoutDimensions();
  useExitOnCtrlC();

  useEffect(() => {
    let isMounted = true;
    void discoverLocalUrls().then(
      (detectedSuggestions) => {
        if (!isMounted) return;
        setSuggestions(detectedSuggestions);
        setIsDetecting(false);
      },
      () => {
        if (isMounted) setIsDetecting(false);
      },
    );
    return () => {
      isMounted = false;
    };
  }, [discoverLocalUrls]);

  const updateUrl = (nextUrl: string): void => {
    setUrl(nextUrl.slice(0, RUNTIME_SCAN_MAX_STRING_LENGTH));
    setValidationMessage(null);
  };

  useInput((input, key) => {
    if (mode === "select") {
      const optionCount = suggestions.length + 1;
      if (key.escape || input === "q") return onSubmit(null);
      if (key.upArrow || input === "k") {
        return setSelectedIndex(Math.max(0, selectedIndex - 1));
      }
      if (key.downArrow || input === "j") {
        return setSelectedIndex(Math.min(optionCount - 1, selectedIndex + 1));
      }
      if (key.return) {
        const selectedSuggestion = suggestions[selectedIndex];
        if (selectedSuggestion !== undefined) return onSubmit(selectedSuggestion.url);
        setMode("custom");
        return;
      }
      if (isPrintableInput(input) && !key.ctrl && !key.meta) {
        setMode("custom");
        updateUrl(input);
      }
      return;
    }

    if (key.escape) return setMode("select");
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
    <Box alignItems="center" height={terminalRows} justifyContent="center" width={terminalColumns}>
      <Box
        borderColor="magenta"
        borderStyle="round"
        flexDirection="column"
        paddingX={RUNTIME_SCAN_PROMPT_PADDING_COLUMNS}
        width={Math.min(terminalColumns, RUNTIME_SCAN_PROMPT_MAX_WIDTH_COLUMNS)}
      >
        <Text color="magenta" bold>
          React Doctor
        </Text>
        <Text bold>Choose an app to scan</Text>
        <Text dimColor>We’ll open Chrome and scan one interaction.</Text>

        {mode === "select" ? (
          <Box flexDirection="column" marginTop={RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS}>
            {isDetecting ? (
              <Text dimColor>
                <Text color="cyan">
                  <Spinner type="dots" />
                </Text>{" "}
                Looking for local apps…
              </Text>
            ) : null}
            {!isDetecting && suggestions.length === 0 ? (
              <Text dimColor>No local HTTP apps detected.</Text>
            ) : null}
            {suggestions.map((suggestion, suggestionIndex) => {
              const isSelected = suggestionIndex === selectedIndex;
              return (
                <Text
                  key={suggestion.url}
                  bold={isSelected}
                  color={isSelected ? "cyan" : undefined}
                >
                  {isSelected ? terminalSymbols.pointer : terminalSymbols.pointerSmall}{" "}
                  {suggestion.url}
                  <Text dimColor> detected</Text>
                </Text>
              );
            })}
            <Text
              bold={selectedIndex === suggestions.length}
              color={selectedIndex === suggestions.length ? "cyan" : undefined}
            >
              {selectedIndex === suggestions.length
                ? terminalSymbols.pointer
                : terminalSymbols.pointerSmall}{" "}
              Enter another URL
            </Text>
            <Box marginTop={RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS}>
              <Text dimColor>↑↓ choose · Enter continue · Esc cancel</Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS}>
            <Text dimColor>App URL</Text>
            <Text wrap="truncate-end">
              <Text color="cyan">{"› "}</Text>
              {url}
              <Text inverse> </Text>
            </Text>
            {validationMessage === null ? null : <Text color="red">{validationMessage}</Text>}
            <Box marginTop={RUNTIME_SCAN_PROMPT_SECTION_GAP_ROWS}>
              <Text dimColor>Enter continue · Esc back · Ctrl+U clear</Text>
            </Box>
          </Box>
        )}
      </Box>
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
