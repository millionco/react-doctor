import { useEffect, useRef, useState } from "react";

declare const fetchUserData: (userId: string) => Promise<{ id: string }>;
declare const processUserData: (data: { id: string }) => string;

// async-defer-await: await a value that the early return doesn't use.
export async function handleRequest(
  userId: string,
  skipProcessing: boolean,
): Promise<{ result: string } | { skipped: true }> {
  const userData = await fetchUserData(userId);
  if (skipProcessing) {
    return { skipped: true };
  }
  return { result: processUserData(userData) };
}

// rerender-state-only-in-handlers: setX called from a handler, x never
// referenced in JSX (transient/non-visual state).
export const TrackedScroller = () => {
  const [offset, setOffset] = useState(0);
  void offset;
  useEffect(() => {
    const onScroll = () => {
      setOffset(window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // No reference to `offset` inside the returned JSX.
  return <div>Scroll handler attached</div>;
};

// client-localstorage-no-version: setItem with key that has no version
// delimiter.
export const persistPreferences = (prefs: { theme: "light" | "dark" }) => {
  localStorage.setItem("userPreferences", JSON.stringify(prefs));
};

// react-compiler-destructure-method: router.push() directly off the
// hook return.
declare function useRouter(): {
  push: (path: string) => void;
  replace: (path: string) => void;
};

export const SignupForm = () => {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Regression: a concise-arrow child component declared INSIDE a
  // block-body component (no BlockStatement body of its own) must not
  // corrupt the per-component hook-binding stack used by
  // `react-compiler-destructure-method`. Before the fix, the implicit
  // `VariableDeclarator:exit` for `LoginLink` popped `SignupForm`'s
  // frame and the `router.push("/welcome")` diagnostic below silently
  // vanished.
  // INTENTIONALLY fires TWO rules at once on this fixture:
  //  - `no-nested-component-definition` (severity: error) on `LoginLink`
  //  - `react-compiler-destructure-method` (severity: warn) on
  //    `router.push("/welcome")` below
  // Tests that count diagnostics for either rule must be tolerant of
  // the other firing on this same component.
  const LoginLink = () => <a href="/login">Log in</a>;
  const handleClick = () => {
    router.push("/welcome");
  };
  return (
    <button ref={buttonRef} onClick={handleClick}>
      Sign up
      <LoginLink />
    </button>
  );
};
