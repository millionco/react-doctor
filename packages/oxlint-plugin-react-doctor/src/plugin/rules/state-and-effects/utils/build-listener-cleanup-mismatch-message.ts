export const buildListenerCleanupMismatchMessage = (
  eventName: string,
  registrationCapture: boolean,
  removalCapture: boolean,
  callbackComparison: "different" | "same",
): string => {
  const hasCallbackMismatch = callbackComparison === "different";
  const hasCaptureMismatch = registrationCapture !== removalCapture;
  if (hasCallbackMismatch && hasCaptureMismatch) {
    return `The cleanup removes \`${eventName}\` with a different callback binding and capture ${String(removalCapture)}, but it was registered with capture ${String(registrationCapture)}. Pass the same callback binding and capture flag to both EventTarget calls.`;
  }
  if (hasCallbackMismatch) {
    return `The cleanup removes \`${eventName}\` with a different callback binding than the one registered, so \`removeEventListener\` cannot detach that listener. Pass the same callback binding to both calls.`;
  }
  return `The cleanup removes \`${eventName}\` with capture ${String(removalCapture)}, but it was registered with capture ${String(registrationCapture)}. \`removeEventListener\` must use the same capture flag as \`addEventListener\`.`;
};
