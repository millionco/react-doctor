// rule: no-prop-callback-in-render
// weakness: cross-file
// source: React Bench fix-react-cloudscape-design-components-4461
exports.useMultipleFocusControl = useMultipleFocusControl;

function useMultipleFocusControl(activeDrawerIds: string[]) {
  activeDrawerIds.forEach((drawerId) => {
    consume(drawerId);
  });
}
