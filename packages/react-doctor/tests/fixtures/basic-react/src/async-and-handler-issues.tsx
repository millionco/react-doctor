import { useEffect } from "react";

declare const fetchUser: (id: string) => Promise<{ id: string }>;
declare const sendAnalytics: (event: string) => Promise<void>;

// async-await-in-loop: sequential await inside for-of.
export const fetchAllUsers = async (ids: string[]) => {
  const users: Array<{ id: string }> = [];
  for (const id of ids) {
    const user = await fetchUser(id);
    users.push(user);
  }
  return users;
};

// async-await-in-loop: forEach with async callback.
export const trackAll = (events: string[]) => {
  events.forEach(async (event) => {
    await sendAnalytics(event);
  });
};

// NEGATIVE case for async-await-in-loop: nested async function inside the
// loop body — its `await` belongs to the inner function, not the loop.
// This must NOT trigger the rule (regression coverage for the walkAst
// skip-subtree fix).
export const queueAllUsers = async (ids: string[]) => {
  const callbacks: Array<() => Promise<void>> = [];
  for (const id of ids) {
    callbacks.push(async () => {
      await fetchUser(id);
    });
  }
  return callbacks;
};

// NEGATIVE case for async-await-in-loop: `Promise.all(items.map(async …))`
// is the canonical parallel-async pattern. The awaits inside the map
// callback produce Promises that `Promise.all` awaits concurrently, so the
// rule must NOT fire here (regression coverage for the Promise.all-wrap
// false-positive fix).
export const fetchAllUsersParallel = async (ids: string[]) => {
  return Promise.all(
    ids.map(async (id) => {
      return await fetchUser(id);
    }),
  );
};

// advanced-event-handler-refs: useEffect re-subscribes when handler prop
// identity changes.
export const Ticker = ({ onTick }: { onTick: () => void }) => {
  useEffect(() => {
    window.addEventListener("scroll", onTick);
    return () => window.removeEventListener("scroll", onTick);
  }, [onTick]);
  return <div>tracking</div>;
};

// rerender-defer-reads-hook: useSearchParams read only inside handler.
declare const useSearchParams: () => URLSearchParams;

export const ShareButton = () => {
  const searchParams = useSearchParams();
  return (
    <button
      onClick={() => {
        const ref = searchParams.get("ref");
        void ref;
      }}
    >
      Share
    </button>
  );
};

// rerender-derived-state-from-hook: useWindowWidth compared to threshold.
declare const useWindowWidth: () => number;

export const ResponsiveTitle = () => {
  const width = useWindowWidth();
  const isMobile = width < 768;
  return <h1 className={isMobile ? "small" : "large"}>Hi</h1>;
};
