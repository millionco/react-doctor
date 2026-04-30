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
