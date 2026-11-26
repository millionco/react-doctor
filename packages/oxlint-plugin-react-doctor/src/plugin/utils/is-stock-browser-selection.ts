export const isStockBrowserSelection = (browserslist: unknown): boolean => {
  if (typeof browserslist !== "object" || !browserslist || Array.isArray(browserslist))
    return false;
  const environments = browserslist as Record<string, unknown>;
  if (Object.keys(environments).length !== 2) return false;
  return (
    JSON.stringify(environments.production) === '[">0.2%","not dead","not op_mini all"]' &&
    JSON.stringify(environments.development) ===
      '["last 1 chrome version","last 1 firefox version","last 1 safari version"]'
  );
};
