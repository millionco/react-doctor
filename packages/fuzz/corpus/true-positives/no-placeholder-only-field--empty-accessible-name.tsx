// rule: no-placeholder-only-field
// weakness: empty-static-value
// source: Bugbot review on PR #850

export const PlaceholderOnlySearch = () => <input aria-label=" " placeholder="Search docs" />;
