import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

const expectFail = (code: string): void => {
  const result = runRule(noFetchInEffect, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noFetchInEffect, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("state-and-effects/no-fetch-in-effect — regressions", () => {
  it("does not flag a fetch cancelled via AbortController in the cleanup", () => {
    expectPass(`
      const useSubtitles = (subtitlesUrl) => {
        useEffect(() => {
          const controller = new AbortController();
          fetch(subtitlesUrl, { signal: controller.signal })
            .then((response) => response.text())
            .then(setSubtitles);
          return () => controller.abort();
        }, [subtitlesUrl]);
      };
    `);
  });

  it("does not flag an aliased signal passed through a const options object", () => {
    expectPass(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const controller = new AbortController();
          const signal = controller.signal;
          const options = { signal };
          fetch(url, options).then((response) => response.json()).then(setProfile);
          return () => controller.abort();
        }, [url]);
        return null;
      };
    `);
  });

  it("does not flag a fetch guarded by a cancelled flag set in the cleanup", () => {
    expectPass(`
      const GithubSection = ({ isOpen }) => {
        useEffect(() => {
          if (!isOpen) return undefined;
          let isCancelled = false;
          const fetchAboutInfo = async () => {
            const response = await fetch("https://api.github.com/repos/x/y");
            if (isCancelled) return;
            setStars(await response.json());
          };
          fetchAboutInfo();
          return () => {
            isCancelled = true;
          };
        }, [isOpen]);
        return null;
      };
    `);
  });

  it("does not flag a promise completion gated by an ignore flag", () => {
    expectPass(`
      const SearchResults = ({ query }) => {
        useEffect(() => {
          let ignore = false;
          fetch("/api/search?q=" + query)
            .then((response) => response.json())
            .then((results) => {
              if (!ignore) setResults(results);
            });
          setLoading(true);
          return () => {
            ignore = true;
          };
        }, [query]);
        return null;
      };
    `);
  });

  it("flags cleanup that aborts a controller not passed to the request", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const controller = new AbortController();
          fetch(url).then((response) => response.json()).then(setProfile);
          return () => controller.abort();
        }, [url]);
        return null;
      };
    `);
  });

  it("flags cleanup that aborts a different request controller", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const requestController = new AbortController();
          const cleanupController = new AbortController();
          fetch(url, { signal: requestController.signal })
            .then((response) => response.json())
            .then(setProfile);
          return () => cleanupController.abort();
        }, [url]);
        return null;
      };
    `);
  });

  it("flags a cancellation flag that never guards the completion sink", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          let isCancelled = false;
          fetch(url).then((response) => response.json()).then(setProfile);
          return () => {
            isCancelled = true;
          };
        }, [url]);
        return null;
      };
    `);
  });

  it("flags a cancellation flag checked with the stale-result polarity", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          let isCancelled = false;
          fetch(url).then(async (response) => {
            const profile = await response.json();
            if (isCancelled) setProfile(profile);
          });
          return () => {
            isCancelled = true;
          };
        }, [url]);
        return null;
      };
    `);
  });

  it("flags effects when only one of multiple requests uses the aborted signal", () => {
    expectFail(`
      const Dashboard = ({ profileUrl, activityUrl }) => {
        useEffect(() => {
          const controller = new AbortController();
          fetch(profileUrl, { signal: controller.signal }).then(setProfile);
          fetch(activityUrl).then(setActivity);
          return () => controller.abort();
        }, [profileUrl, activityUrl]);
        return null;
      };
    `);
  });

  it("does not flag a call to a locally-declared fetch mock", () => {
    expectPass(`
      export default function ServerSidePaginationDemo() {
        const fetch = useCallback(async (page, perPage) => {
          const result = await fakeFetch(page, perPage);
          setData(result.rows);
        }, []);
        useEffect(() => {
          fetch(1, 10);
        }, []);
        return null;
      }
    `);
  });

  it("still flags a bare fetch with no cleanup", () => {
    expectFail(`
      const Widget = () => {
        useEffect(() => {
          fetch("/api/data")
            .then((response) => response.json())
            .then(setData);
        }, []);
        return null;
      };
    `);
  });

  it("still flags an imported fetch wrapper", () => {
    expectFail(`
      import { fetch } from "~/shared/fetch.client";
      const Logout = ({ urls }) => {
        useEffect(() => {
          Promise.allSettled(urls.map(async (url) => fetch(url, { method: "POST" })));
        }, [urls]);
        return null;
      };
    `);
  });

  it("still flags axios.get with an unrelated cleanup", () => {
    expectFail(`
      import axios from "axios";
      const Widget = () => {
        useEffect(() => {
          axios.get("/api/data").then(({ data }) => setData(data));
          const id = setInterval(poll, 1000);
          return () => clearInterval(id);
        }, []);
        return null;
      };
    `);
  });

  it("still flags fetch hidden in a component-scope helper", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        const loadProfile = async () => {
          const response = await fetch(url);
          setData(await response.json());
        };
        useEffect(() => {
          void loadProfile();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });

  it("still flags fetch when cleanup only toggles an unrelated boolean", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then(setData);
          return () => {
            windowFocusTracker.isSubscribed = false;
          };
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });

  it("still flags XMLHttpRequest inside an effect", () => {
    expectFail(`
      const Profile = ({ url }) => {
        const [data, setData] = useState(null);
        useEffect(() => {
          const request = new XMLHttpRequest();
          request.open("GET", url);
          request.onload = () => setData(JSON.parse(request.responseText));
          request.send();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `);
  });

  it("flags a fetch inside an effect-registered event listener", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const onFocus = () => {
            fetch(url).then((response) => response.json()).then(setProfile);
          };
          window.addEventListener("focus", onFocus);
          return () => window.removeEventListener("focus", onFocus);
        }, [url]);
        return null;
      };
    `);
  });

  it("flags a fetch inside an effect-scheduled timer callback", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const timer = setTimeout(() => {
            fetch(url).then((response) => response.json()).then(setProfile);
          }, 100);
          return () => clearTimeout(timer);
        }, [url]);
        return null;
      };
    `);
  });

  it("ignores a fetch inside an unreferenced nested declaration", () => {
    expectPass(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const neverCalled = () => {
            fetch(url).then((response) => response.json()).then(setProfile);
          };
          console.log("mounted");
        }, [url]);
        return null;
      };
    `);
  });

  it("does not flag an event-listener fetch cancelled by its matching controller", () => {
    expectPass(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const controller = new AbortController();
          const onFocus = () => {
            fetch(url, { signal: controller.signal })
              .then((response) => response.json())
              .then(setProfile);
          };
          window.addEventListener("focus", onFocus);
          return () => {
            window.removeEventListener("focus", onFocus);
            controller.abort();
          };
        }, [url]);
        return null;
      };
    `);
  });

  it("does not flag a timer fetch whose completion uses the matching ignore flag", () => {
    expectPass(`
      const Profile = ({ url }) => {
        useEffect(() => {
          let ignore = false;
          const timer = setTimeout(async () => {
            const response = await fetch(url);
            if (ignore) return;
            setProfile(await response.json());
          }, 100);
          return () => {
            ignore = true;
            clearTimeout(timer);
          };
        }, [url]);
        return null;
      };
    `);
  });

  it("flags a listener fetch when cleanup aborts an unrelated controller", () => {
    expectFail(`
      const Profile = ({ url }) => {
        useEffect(() => {
          const requestController = new AbortController();
          const cleanupController = new AbortController();
          const onFocus = () => {
            fetch(url, { signal: requestController.signal }).then(setProfile);
          };
          window.addEventListener("focus", onFocus);
          return () => {
            window.removeEventListener("focus", onFocus);
            cleanupController.abort();
          };
        }, [url]);
        return null;
      };
    `);
  });
});
