export const formatPlaybackTime = (seconds: number) => {
  const tenths = Math.floor(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const wholeSeconds = Math.floor((tenths % 600) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${tenths % 10}`;
};
