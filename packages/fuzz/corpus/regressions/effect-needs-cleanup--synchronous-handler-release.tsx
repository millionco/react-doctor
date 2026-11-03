// rule: effect-needs-cleanup
// weakness: control-flow
// source: synthetic

export const SynchronousHandlerRelease = () => {
  const handleClick = () => {
    const handle = setInterval(() => {});
    clearInterval(handle);
  };

  return <button onClick={handleClick}>Run</button>;
};
