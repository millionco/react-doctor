// Best-effort terminate a process by pid: ignore ESRCH (already gone) and EPERM
// (not ours), since this only ever cleans up a Chrome we just spawned.
export const killProcess = (pid: number): void => {
  try {
    process.kill(pid);
  } catch {}
};
