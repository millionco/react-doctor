// rule: rerender-memo-with-default-value
// weakness: wrapper-transparency
// source: React Bench xr843-fojin-775 K4iJZDj — StableChatMessage.tsx
import { memo } from "react";

interface SuggestionsProps {
  hidden: boolean;
  suggestions: readonly string[];
}

const sameSuggestions = (
  previousSuggestions: readonly string[],
  nextSuggestions: readonly string[],
) =>
  previousSuggestions.length === nextSuggestions.length &&
  previousSuggestions.every(
    (suggestion, suggestionIndex) => suggestion === nextSuggestions[suggestionIndex],
  );

const FollowUpSuggestions = memo(
  ({ suggestions }: SuggestionsProps) => <div>{suggestions.length}</div>,
  (previousProps, nextProps) =>
    previousProps.hidden === nextProps.hidden &&
    sameSuggestions(previousProps.suggestions, nextProps.suggestions),
);

export const StableChatMessage = ({
  hidden = false,
  suggestions = [],
}: Partial<SuggestionsProps>) => <FollowUpSuggestions hidden={hidden} suggestions={suggestions} />;
