// rule: click-events-have-key-events
// weakness: conditional-native-keyboard-control
// source: synthetic audit regression
export function Choice({
  enabled = false,
  checked = false,
  chooseValue,
  translate,
  otherGate,
  getGate,
}) {
  const choose = (event) => {
    event.stopPropagation();
    chooseValue?.(!checked);
  };
  return (
    <div
      className={`choice-card relative flex w-full overflow-hidden hover:shadow-sm ${enabled ? "cursor-pointer" : ""} ${enabled && checked ? "ring-2" : ""}`}
      onClick={enabled ? choose : undefined}
    >
      {enabled && (
        <button
          type="button"
          onClick={choose}
          className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border ${checked ? "bg-neutral-600 text-white border-neutral-600" : "bg-white/90 text-transparent border-neutral-300 dark:bg-neutral-800/90"} shadow-sm`}
          title={checked ? translate("Clear") : translate("Choose")}
        >
          <svg aria-hidden="true" />
        </button>
      )}
      <span>Details</span>
    </div>
  );
}
