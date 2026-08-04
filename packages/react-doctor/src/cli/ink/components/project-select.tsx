import path from "node:path";
import figures from "figures";
import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
import type { WorkspacePackage } from "@react-doctor/core";
import {
  METRIC,
  TUI_PROJECT_SELECT_CHROME_ROWS,
  TUI_PROJECT_SELECT_FILTER_ROWS,
  TUI_PROJECT_SELECT_FOOTER_MARGIN_ROWS,
  TUI_PROJECT_SELECT_MIN_LIST_ROWS,
  TUI_PROJECT_NAME_GAP_COLUMNS,
} from "../../utils/constants.js";
import { clampNumber } from "../../utils/clamp-number.js";
import { isPrintableInput } from "../../utils/is-printable-input.js";
import { recordCount } from "../../utils/record-metric.js";
import { resolveVisibleStart } from "../../utils/resolve-visible-start.js";
import { useExitOnCtrlC } from "../hooks/use-exit-on-ctrl-c.js";
import { useStdoutDimensions } from "../hooks/use-stdout-dimensions.js";
import { fuzzyMatch } from "../lib/fuzzy-match.js";
import { useEffect, useMemo, useRef, useState } from "../react-runtime.js";

export interface ProjectSelectProps {
  readonly packages: ReadonlyArray<WorkspacePackage>;
  readonly rootDirectory: string;
  readonly onSubmit: (directories: string[]) => void;
}

type SelectMode = "list" | "search";

interface ScoredPackage {
  readonly workspacePackage: WorkspacePackage;
  readonly matchedIndices: ReadonlyArray<number>;
  readonly relativeDirectory: string;
}

interface MatchedNameProps {
  readonly name: string;
  readonly matchedIndices: ReadonlyArray<number>;
  readonly isSelected: boolean;
}

const MatchedName = ({ name, matchedIndices, isSelected }: MatchedNameProps) => {
  if (matchedIndices.length === 0) {
    return (
      <Text bold={isSelected} wrap="truncate-end">
        {name}
      </Text>
    );
  }
  const matchedIndexSet = new Set(matchedIndices);
  return (
    <Text bold={isSelected} wrap="truncate-end">
      {[...name].map((character, index) =>
        matchedIndexSet.has(index) ? (
          <Text key={index} color="yellow">
            {character}
          </Text>
        ) : (
          character
        ),
      )}
    </Text>
  );
};

export const ProjectSelect = ({ packages, rootDirectory, onSubmit }: ProjectSelectProps) => {
  const { rows: terminalRows } = useStdoutDimensions();
  useExitOnCtrlC();

  const [selectionMode, setSelectionMode] = useState<SelectMode>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [checkedDirectories, setCheckedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const didRecordProjectPathContext = useRef(false);

  const matchedPackages = useMemo<ReadonlyArray<ScoredPackage>>(() => {
    const scoredPackages = packages.flatMap((workspacePackage) => {
      const result = fuzzyMatch(searchQuery, workspacePackage.name);
      return result ? [{ workspacePackage, result }] : [];
    });
    if (searchQuery.length > 0) {
      scoredPackages.sort(
        (leftPackage, rightPackage) => rightPackage.result.score - leftPackage.result.score,
      );
    }
    return scoredPackages.map(({ workspacePackage, result }) => ({
      workspacePackage,
      matchedIndices: result.matchedIndices,
      relativeDirectory: path.relative(rootDirectory, workspacePackage.directory) || ".",
    }));
  }, [packages, rootDirectory, searchQuery]);
  const hasProjectPathContext = matchedPackages.some(
    ({ relativeDirectory, workspacePackage }) => relativeDirectory !== workspacePackage.name,
  );

  useEffect(() => {
    if (!hasProjectPathContext || didRecordProjectPathContext.current) return;
    didRecordProjectPathContext.current = true;
    recordCount(METRIC.tuiProjectPathContextShown);
  }, [hasProjectPathContext]);

  const isSearching = selectionMode === "search";
  const hasFilterLine = isSearching || searchQuery.length > 0;
  const listHeight = Math.max(
    TUI_PROJECT_SELECT_MIN_LIST_ROWS,
    Math.min(
      Math.max(matchedPackages.length, TUI_PROJECT_SELECT_MIN_LIST_ROWS),
      terminalRows -
        TUI_PROJECT_SELECT_CHROME_ROWS -
        (hasFilterLine ? TUI_PROJECT_SELECT_FILTER_ROWS : 0),
    ),
  );

  const selectedPackageIndex =
    matchedPackages.length === 0 ? 0 : clampNumber(selectedIndex, 0, matchedPackages.length - 1);
  const selectedWorkspacePackage = matchedPackages[selectedPackageIndex]?.workspacePackage;

  const updateFilter = (nextSearchQuery: string): void => {
    setSearchQuery(nextSearchQuery);
    setSelectedIndex(0);
    setScrollOffset(0);
  };

  const moveSelection = (indexDelta: number): void => {
    if (matchedPackages.length === 0) return;
    const nextSelectedIndex = clampNumber(
      selectedPackageIndex + indexDelta,
      0,
      matchedPackages.length - 1,
    );
    setSelectedIndex(nextSelectedIndex);
    setScrollOffset((currentOffset) => {
      if (nextSelectedIndex < currentOffset) return nextSelectedIndex;
      if (nextSelectedIndex >= currentOffset + listHeight) {
        return nextSelectedIndex - listHeight + 1;
      }
      return currentOffset;
    });
  };

  const toggleCheckedDirectory = (directory: string): void => {
    setCheckedDirectories((currentCheckedDirectories) => {
      const updatedCheckedDirectories = new Set(currentCheckedDirectories);
      if (updatedCheckedDirectories.has(directory)) updatedCheckedDirectories.delete(directory);
      else updatedCheckedDirectories.add(directory);
      return updatedCheckedDirectories;
    });
  };

  const submitDirectories = (directories: ReadonlyArray<string>): void => {
    onSubmit([...directories]);
  };

  const submitSelection = (): void => {
    if (checkedDirectories.size > 0) {
      const selectedDirectories: string[] = [];
      for (const workspacePackage of packages) {
        if (checkedDirectories.has(workspacePackage.directory)) {
          selectedDirectories.push(workspacePackage.directory);
        }
      }
      return submitDirectories(selectedDirectories);
    }
    if (selectedWorkspacePackage) submitDirectories([selectedWorkspacePackage.directory]);
  };

  useInput((input, key) => {
    if (isSearching) {
      if (key.return) return setSelectionMode("list");
      if (key.escape) {
        updateFilter("");
        return setSelectionMode("list");
      }
      if (key.downArrow || (key.ctrl && input === "n")) return moveSelection(1);
      if (key.upArrow || (key.ctrl && input === "p")) return moveSelection(-1);
      if (key.backspace || key.delete) return updateFilter(searchQuery.slice(0, -1));
      if (isPrintableInput(input) && !key.ctrl && !key.meta) updateFilter(searchQuery + input);
      return;
    }

    if (input === "/") return setSelectionMode("search");
    if (input === " ") {
      if (selectedWorkspacePackage) toggleCheckedDirectory(selectedWorkspacePackage.directory);
      return;
    }
    if (input === "a") {
      if (matchedPackages.length === 0) return;
      setCheckedDirectories((currentCheckedDirectories) => {
        const updatedCheckedDirectories = new Set(currentCheckedDirectories);
        const shouldClearMatches = matchedPackages.every((matchedPackage) =>
          currentCheckedDirectories.has(matchedPackage.workspacePackage.directory),
        );
        for (const matchedPackage of matchedPackages) {
          if (shouldClearMatches) {
            updatedCheckedDirectories.delete(matchedPackage.workspacePackage.directory);
          } else {
            updatedCheckedDirectories.add(matchedPackage.workspacePackage.directory);
          }
        }
        return updatedCheckedDirectories;
      });
      return;
    }
    if (input === "q") return submitDirectories([]);
    if (key.escape) {
      if (searchQuery.length > 0) return updateFilter("");
      if (checkedDirectories.size > 0) return setCheckedDirectories(new Set());
      return submitDirectories([]);
    }
    if (key.return) return submitSelection();
    if (key.downArrow || input === "j") return moveSelection(1);
    if (key.upArrow || input === "k") return moveSelection(-1);
    if (key.pageDown) return moveSelection(listHeight);
    if (key.pageUp) return moveSelection(-listHeight);
  });

  const visibleStart = resolveVisibleStart({
    itemCount: matchedPackages.length,
    offset: scrollOffset,
    selectedIndex: selectedPackageIndex,
    viewportHeight: listHeight,
  });
  const visibleMatches = matchedPackages.slice(visibleStart, visibleStart + listHeight);
  const longestNameLength = Math.max(
    0,
    ...packages.map((workspacePackage) => workspacePackage.name.length),
  );
  let filterLine: ReactNode = null;
  if (isSearching) {
    filterLine = (
      <Text wrap="truncate-end">
        <Text color="cyan">{"/ "}</Text>
        {searchQuery.length > 0 ? <Text>{searchQuery}</Text> : null}
        <Text inverse> </Text>
      </Text>
    );
  } else if (searchQuery.length > 0) {
    filterLine = (
      <Text dimColor wrap="truncate-end">
        {`filter: ${searchQuery}`}
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>Select projects to scan</Text>
        <Text dimColor>
          {"  "}
          {checkedDirectories.size}/{packages.length}
        </Text>
      </Text>
      {filterLine}
      <Box flexDirection="column" height={listHeight}>
        {matchedPackages.length === 0 ? (
          <Text dimColor>No matching projects</Text>
        ) : (
          visibleMatches.map((matchedPackage, visiblePackageIndex) => {
            const matchIndex = visibleStart + visiblePackageIndex;
            const isSelected = matchIndex === selectedPackageIndex;
            const isChecked = checkedDirectories.has(matchedPackage.workspacePackage.directory);
            const shouldShowRelativeDirectory =
              matchedPackage.relativeDirectory !== matchedPackage.workspacePackage.name;
            return (
              <Text key={matchedPackage.workspacePackage.directory} wrap="truncate-end">
                <Text color={isSelected ? "cyan" : undefined}>
                  {isSelected ? `${figures.pointer} ` : "  "}
                </Text>
                <Text color={isChecked ? "green" : undefined}>
                  {isChecked ? `${figures.radioOn} ` : `${figures.radioOff} `}
                </Text>
                <MatchedName
                  name={matchedPackage.workspacePackage.name}
                  matchedIndices={matchedPackage.matchedIndices}
                  isSelected={isSelected}
                />
                {shouldShowRelativeDirectory ? (
                  <Text dimColor>
                    {" ".repeat(
                      longestNameLength -
                        matchedPackage.workspacePackage.name.length +
                        TUI_PROJECT_NAME_GAP_COLUMNS,
                    )}
                    {matchedPackage.relativeDirectory}
                  </Text>
                ) : null}
              </Text>
            );
          })
        )}
      </Box>
      <Box marginTop={TUI_PROJECT_SELECT_FOOTER_MARGIN_ROWS}>
        <Text dimColor wrap="truncate-end">
          {isSearching ? (
            "type to filter · enter confirm · esc clear"
          ) : (
            <>
              {"space select · a all · / search · "}
              <Text color="cyan">enter</Text>
              {" to submit · q cancel"}
            </>
          )}
        </Text>
      </Box>
    </Box>
  );
};
