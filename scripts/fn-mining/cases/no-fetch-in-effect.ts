import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `fetch()` inside `useEffect`. Variants probe fetch-call
// indirection, alternative clients, member-form hooks, and the
// cancellation-cleanup carve-out.
export const noFetchInEffectCases: FnMiningCase[] = [
  {
    ruleId: "no-fetch-in-effect",
    description: "canonical: fetch().then() directly in the effect body",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then(setData);
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "axios.get inside the effect",
    filePath: "src/profile.tsx",
    code: `
      import axios from "axios";
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        useEffect(() => {
          axios.get(url).then((response) => setData(response.data));
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "fetch inside an async function declared and invoked within the effect",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        useEffect(() => {
          const load = async () => {
            const response = await fetch(url);
            setData(await response.json());
          };
          load();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "fetch hidden in a component-scope helper called from the effect",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        const loadProfile = async () => {
          const response = await fetch(url);
          setData(await response.json());
        };
        useEffect(() => {
          void loadProfile();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "cleanup assigns an unrelated boolean (no cancellation guard on the fetch)",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        useEffect(() => {
          fetch(url).then((response) => response.json()).then(setData);
          return () => {
            windowFocusTracker.isSubscribed = false;
          };
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "member-form hook: React.useEffect with a direct fetch",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = React.useState<Data | null>(null);
        React.useEffect(() => {
          fetch(url).then((response) => response.json()).then(setData);
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "no-fetch-in-effect",
    description: "raw XMLHttpRequest inside the effect (non-fetch network client)",
    filePath: "src/profile.tsx",
    code: `
      const Profile = ({ url }: { url: string }) => {
        const [data, setData] = useState<Data | null>(null);
        useEffect(() => {
          const request = new XMLHttpRequest();
          request.open("GET", url);
          request.onload = () => setData(JSON.parse(request.responseText));
          request.send();
        }, [url]);
        return <div>{data?.name}</div>;
      };
    `,
    shouldFire: true,
  },
];
