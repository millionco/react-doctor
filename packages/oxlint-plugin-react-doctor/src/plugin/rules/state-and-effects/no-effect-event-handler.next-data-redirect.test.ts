import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noEffectEventHandler } from "./no-effect-event-handler.js";

interface NextPageRedirectCase {
  name: string;
  code: string;
  expectedCount: number;
  options?: RunRuleOptions;
}

const commonOptions: RunRuleOptions = {
  filename: "src/pages/items/[item].tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react", "nextjs"],
      portedRuleMode: "curated",
    },
  },
};

const cases: NextPageRedirectCase[] = [
  {
    name: "native-static-data-page",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "named-router-alias",
    code: 'import { useEffect } from "react"; import { useRouter as usePageRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = usePageRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "native-server-data-page",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getServerSideProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "returned-props-missing-selected-key",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { otherValue: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "no-data-export",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "nondefault-child-in-data-module",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Child = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default function Page() { return <Child destination="/archive" record={null} />; }\n',
    expectedCount: 1,
  },
  {
    name: "foreign-router-provider",
    code: 'import { useEffect } from "react"; import { useRouter } from "other-navigation";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-router-provider",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const useRouter = obtainRouter; const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "type-only-router-provider",
    code: 'import { useEffect } from "react"; import type { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "fixed-literal-destination",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace("/archive"); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "push-not-in-first-profile",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.push(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "additional-one-shot-work",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { toast("Changed"); router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "local-data-name-not-exported",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nasync function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "nonpage-filename",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/components/RoutePanel.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "nextjs"], portedRuleMode: "curated" },
      },
    },
  },
  {
    name: "opaque-default-wrapper",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default wrapPage(Page);\n',
    expectedCount: 1,
  },
  {
    name: "selected-router-whole-value-alias",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); const escapedRouter = router; void escapedRouter; useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "named-effect-alias",
    code: 'import { useEffect as usePageEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); usePageEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "renamed-explicit-page-props",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination: target, record: entry }) => { const router = useRouter(); useEffect(() => { if (target && !entry) { router.replace(target); } }, [target, entry]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "direct-default-function-page",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nfunction Page({ destination, record }) { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "const-data-export",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport const getStaticProps = async () => ({ props: { destination: "/archive", record: null } });\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "separate-own-returned-prop-paths",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps(context) { if (context.preview) return { props: { destination: "/archive" } }; return { props: { record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "unused-react-default-and-type-only-member",
    code: 'import React, { useEffect, type CSSProperties } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\ntype Frame = React.ReactFragment; type Layout = CSSProperties;\n',
    expectedCount: 0,
  },
  {
    name: "unrelated-window-and-router-fallback",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); if (router.isFallback) return null; window.twttr?.widgets?.load(); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "unused-native-react-namespace",
    code: 'import * as ReactTypes from "react"; import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "root-pages-host",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
    options: {
      filename: "pages/items.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "nextjs"], portedRuleMode: "curated" },
      },
    },
  },
  {
    name: "pages-api-is-not-page",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/pages/api/items.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "nextjs"], portedRuleMode: "curated" },
      },
    },
  },
  {
    name: "custom-app-is-not-page",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/pages/_app.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "nextjs"], portedRuleMode: "curated" },
      },
    },
  },
  {
    name: "app-router-is-not-pages",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/app/items/page.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": { capabilities: ["react", "nextjs"], portedRuleMode: "curated" },
      },
    },
  },
  {
    name: "missing-next-capability",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/pages/items/[item].tsx",
      forceJsx: true,
      includeLocations: true,
      settings: { "react-doctor": { capabilities: ["react"], portedRuleMode: "curated" } },
    },
  },
  {
    name: "missing-all-capabilities",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
    options: {
      filename: "src/pages/items/[item].tsx",
      forceJsx: true,
      includeLocations: true,
      settings: { "react-doctor": { capabilities: [], portedRuleMode: "curated" } },
    },
  },
  {
    name: "opaque-data-result",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return loadPageProps(); }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "returned-props-spread",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { ...knownProps, destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "computed-returned-key",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { ["destination"]: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "duplicate-returned-key",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", destination: "/other", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "getter-returned-key",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { get destination() { return "/archive"; }, record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "nested-return-is-not-data-transport",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { const build = () => ({ props: { destination: "/archive", record: null } }); return externalProps; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "aliased-data-export",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nconst buildProps = async () => ({ props: { destination: "/archive", record: null } }); export { buildProps as getStaticProps };\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "escaped-data-export",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nconsume(getStaticProps);\n',
    expectedCount: 1,
  },
  {
    name: "page-binding-local-consumer",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nconst renderedPage = <Page destination="/other" record={null} />;\n',
    expectedCount: 1,
  },
  {
    name: "page-binding-call",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nPage({ destination: "/other", record: null });\n',
    expectedCount: 1,
  },
  {
    name: "mutable-page-binding",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nlet Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "written-selected-prop",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); destination = "/changed"; useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "parameter-default-is-unsupported",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination = "/fallback", record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "parameter-rest-is-unsupported",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record, ...rest }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "written-router-method",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); router.replace = replacement; useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "router-member-method-transport",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); const replace = router.replace; useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "router-other-member",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); void router.pathname; useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "second-use-router-call",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const unusedRouter = useRouter(); const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "named-router-import-reassigned",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nuseRouter = replacement;\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "runtime-react-namespace",
    code: 'import * as ReactCarrier from "react"; void ReactCarrier.useEffect; import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "runtime-next-default",
    code: 'import { useEffect } from "react"; import RouterCarrier from "next/router"; void RouterCarrier; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "extra-next-named-provider",
    code: 'import { useEffect } from "react"; import { useRouter, Router } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "type-only-react-hook",
    code: 'import type { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "runtime-type-only-react-carrier",
    code: 'import type { useState as TypeState } from "react"; void TypeState; import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "inline-type-only-router-hook",
    code: 'import { useEffect } from "react"; import { type useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "react-hook-provider-alias",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nconst effectAlias = useEffect;\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "react-hook-provider-write",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nuseEffect = replacement;\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "known-node-loader",
    code: 'import { createRequire } from "node:module";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "global-eval-exposure",
    code: 'void eval;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "global-function-exposure",
    code: 'void Function;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "constructor-member-exposure",
    code: 'void ordinaryValue.constructor;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "constructor-pattern-exposure",
    code: 'const { constructor: constructorValue } = ordinaryValue;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "dynamic-import-exposure",
    code: 'const lazyModule = import("ordinary-library");\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "runtime-typescript-enum",
    code: 'enum ProviderContainer { Entry }\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-loader-name",
    code: 'const module = {}; void module;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "erased-loader-import",
    code: 'import type { createRequire } from "node:module"; type Loader = typeof createRequire;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "extra-effect-action",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); toast("Updated"); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "else-action",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } else { toast("Missing"); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "used-replacement-result",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { return router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "effect-callback-parameter",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect((ignored) => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "async-effect-callback",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(async () => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "binary-guard-outside-finite-grammar",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination !== null && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "additional-replace-argument",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination, undefined); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "nested-selected-effect-owner",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); const useRedirect = () => { useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); }; useRedirect(); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "conditional-effect-call",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); if (record) { useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); } return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "inherited-cleanup-exception",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } return () => {}; }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "nested-global-window-provider",
    code: 'void globalThis.window.next.router;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "global-window-whole-alias",
    code: 'const browserCarrier = globalThis.window; void browserCarrier;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "recursive-window-self-provider",
    code: 'void window.self.next.router;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "direct-browser-frames-provider",
    code: 'void frames.next.router;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "projected-browser-parent-provider",
    code: 'void window.parent.next.router;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "shadowed-global-namespace-carrier",
    code: 'const globalThis = { window: { next: { router: null } } }; void globalThis.window.next.router;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "erased-global-namespace-carrier",
    code: 'type BrowserCarrier = typeof globalThis.window;\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "const-data-export-whole-value-escape",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport const getStaticProps = async () => ({ props: { destination: "/archive", record: null } });\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nconsume(getStaticProps);\n',
    expectedCount: 1,
  },
  {
    name: "function-page-jsx-escape",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nfunction Page({ destination, record }) { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nconst extraPage = <Page destination="/other" record={null} />;\n',
    expectedCount: 1,
  },
  {
    name: "function-page-call-escape",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nfunction Page({ destination, record }) { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\nPage({ destination: "/other", record: null });\n',
    expectedCount: 1,
  },
  {
    name: "named-data-self-binding-escape",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { consume(getStaticProps); return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "named-page-self-binding-escape",
    code: 'import { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nfunction Page({ destination, record }) { consume(Page); const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n',
    expectedCount: 1,
  },
  {
    name: "default-create-element",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return React.createElement("span", null, "label"); };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "namespace-create-element",
    code: 'import * as NativeReact from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return NativeReact.createElement("span", null, "label"); };\nexport default Page;\n',
    expectedCount: 0,
  },
  {
    name: "default-provider-whole-alias",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nconst provider = React;\n',
    expectedCount: 1,
  },
  {
    name: "namespace-provider-argument",
    code: 'import * as NativeReact from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nconsume(NativeReact);\n',
    expectedCount: 1,
  },
  {
    name: "default-create-element-member-alias",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nconst makeElement = React.createElement;\n',
    expectedCount: 1,
  },
  {
    name: "default-create-element-replacement",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact.createElement = replacement;\n',
    expectedCount: 1,
  },
  {
    name: "default-use-effect-replacement",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact.useEffect = replacement;\n',
    expectedCount: 1,
  },
  {
    name: "default-computed-create-element",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact["createElement"]("span", null);\n',
    expectedCount: 1,
  },
  {
    name: "default-optional-create-element",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact.createElement?.("span", null);\n',
    expectedCount: 1,
  },
  {
    name: "default-create-element-call-carrier",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact.createElement.call(null, "span", null);\n',
    expectedCount: 1,
  },
  {
    name: "namespace-destructure-create-element",
    code: 'import * as NativeReact from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nconst { createElement } = NativeReact;\n',
    expectedCount: 1,
  },
  {
    name: "default-foreign-method-role",
    code: 'import React from "react";\nimport { useEffect } from "react"; import { useRouter } from "next/router";\nexport async function getStaticProps() { return { props: { destination: "/archive", record: null } }; }\nconst Page = ({ destination, record }) => { const router = useRouter(); useEffect(() => { if (destination && !record) { router.replace(destination); } }, [destination, record]); return null; };\nexport default Page;\n\nReact.useEffect(() => {});\n',
    expectedCount: 1,
  },
];

describe("state-and-effects/no-effect-event-handler Next data redirects", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(
        noEffectEventHandler,
        testCase.code,
        testCase.options ?? commonOptions,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
