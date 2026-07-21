import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMixedIconLibraries } from "./no-mixed-icon-libraries.js";

describe("no-mixed-icon-libraries", () => {
  it("flags imports from separate icon families", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react"; import { HomeIcon } from "@heroicons/react/24/outline"; const Toolbar = () => <><Search /><HomeIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats separate react-icons packs as separate visual families", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { FaHome } from "react-icons/fa"; import { MdSearch } from "react-icons/md"; const Toolbar = () => <><FaHome /><MdSearch /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts subpath imports from one family", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { HomeIcon } from "@heroicons/react/24/outline"; import { CheckIcon } from "@heroicons/react/20/solid"; const Toolbar = () => <><HomeIcon /><CheckIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores type-only and side-effect imports", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import type { LucideIcon } from "lucide-react"; import "@heroicons/react"; const value = 1;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores icon imports that are only collected for other modules to render", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { HiArrowRight } from "react-icons/hi2";
       import { PiHouse } from "react-icons/pi";
       export const iconLibrary = { arrow: HiArrowRight, home: PiHouse };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("only counts imported icon bindings that are rendered", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = { home: HomeIcon };
       const Toolbar = () => <Search />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks aliased and namespace icon imports rendered as JSX", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search as SearchIcon } from "lucide-react";
       import * as HeroIcons from "@heroicons/react/24/outline";
       const Toolbar = () => <><SearchIcon /><HeroIcons.HomeIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks const aliases of rendered icon imports", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const SearchIcon = Search;
       const NavigationIcon = HomeIcon;
       const Toolbar = () => <><SearchIcon /><NavigationIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks icon families selected dynamically from a registry that reaches JSX", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = { search: Search, home: HomeIcon };
       const Toolbar = ({ kind }) => { const Icon = icons[kind]; return <Icon />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps a mixed icon registry quiet when it never reaches JSX", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       export const icons = { search: Search, home: HomeIcon };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves a statically selected registry member instead of expanding the whole registry", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search, HomeIcon };
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last matching property across ordered object spreads", () => {
    const overriddenBySpread = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Other = { Search: HomeIcon };
       const Icons = { Search, ...Other };
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    const overriddenAfterSpread = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Other = { Search: HomeIcon };
       const Icons = { ...Other, Search };
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(overriddenBySpread.diagnostics).toHaveLength(1);
    expect(overriddenAfterSpread.diagnostics).toHaveLength(0);
  });

  it("tracks known post-declaration member writes", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search };
       Icons.Search = HomeIcon;
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks module writes declared after the rendering component", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search };
       const Toolbar = () => <><Icons.Search /><Search /></>;
       Icons.Search = HomeIcon;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when a computed write makes a static member uncertain", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search };
       Icons[getIconName()] = HomeIcon;
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a conditional write makes a static member uncertain", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search };
       const replaceIcon = () => { Icons.Search = HomeIcon; };
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves exact members through registry aliases", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Base = { Search, HomeIcon };
       const Icons = Base;
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves exact nested registry paths without expanding siblings", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { nav: { Search, HomeIcon } };
       const Toolbar = () => <><Icons.nav.Search /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("tracks icon families selected dynamically from an array registry", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = [Search, HomeIcon];
       const Toolbar = ({ kind }) => { const Icon = icons[kind]; return <Icon />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a statically selected array entry instead of expanding the whole registry", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = [Search, HomeIcon];
       const SearchIcon = icons[0];
       const Toolbar = () => <><SearchIcon /><Search /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses effective spread values in a dynamic object registry", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Other = { search: HomeIcon, home: HomeIcon };
       const icons = { search: Search, ...Other };
       const Toolbar = ({ kind }) => { const Icon = icons[kind]; return <><Icon /><Search /></>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the final unconditional value of mutable icon bindings", () => {
    const sameFamily = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       let Icon = Search;
       Icon = HomeIcon;
       const Toolbar = () => <><Icon /><HomeIcon /></>;`,
    );
    const mixedFamilies = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       let Icon = HomeIcon;
       Icon = Search;
       const Toolbar = () => <><Icon /><HomeIcon /></>;`,
    );
    expect(sameFamily.diagnostics).toHaveLength(0);
    expect(mixedFamilies.diagnostics).toHaveLength(1);
  });

  it("uses the final unconditional value of mutable registries", () => {
    const sameFamily = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       let Icons = { Home: Search };
       Icons = { Home: HomeIcon };
       const Toolbar = () => <><Icons.Home /><HomeIcon /></>;`,
    );
    const mixedFamilies = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       let Icons = { Home: HomeIcon };
       Icons = { Home: Search };
       const Toolbar = () => <><Icons.Home /><HomeIcon /></>;`,
    );
    expect(sameFamily.diagnostics).toHaveLength(0);
    expect(mixedFamilies.diagnostics).toHaveLength(1);
  });

  it("resolves const computed registry keys", () => {
    const staticSelection = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const key = "search";
       const icons = { search: Search, home: HomeIcon };
       const Icon = icons[key];
       const Toolbar = () => <Icon />;`,
    );
    const staticWrite = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const key = "Search";
       const Icons = { Search };
       Icons[key] = HomeIcon;
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    expect(staticSelection.diagnostics).toHaveLength(0);
    expect(staticWrite.diagnostics).toHaveLength(1);
  });

  it("resolves icon aliases created by object and array destructuring", () => {
    const objectResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search, HomeIcon };
       const { HomeIcon: Icon } = Icons;
       const Toolbar = () => <><Icon /><Search /></>;`,
    );
    const arrayResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = [Search, HomeIcon];
       const [, Icon] = icons;
       const Toolbar = () => <><Icon /><Search /></>;`,
    );
    expect(objectResult.diagnostics).toHaveLength(1);
    expect(arrayResult.diagnostics).toHaveLength(1);
  });

  it("expands nested dynamic registries", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = { navigation: { search: Search, home: HomeIcon } };
       const Icon = icons.navigation[kind];
       const Toolbar = () => <Icon />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("expands spread array registries but preserves known prefix indices", () => {
    const dynamicResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const first = [Search];
       const icons = [...first, HomeIcon];
       const Icon = icons[kind];
       const Toolbar = () => <Icon />;`,
    );
    const staticResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = [HomeIcon, ...others];
       const index = 0;
       const Icon = icons[index];
       const Toolbar = () => <><Icon /><Search /></>;`,
    );
    expect(dynamicResult.diagnostics).toHaveLength(1);
    expect(staticResult.diagnostics).toHaveLength(1);
  });

  it("evaluates statically deterministic icon branches", () => {
    const conditionalResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icon = true ? Search : HomeIcon;
       const Toolbar = () => <Icon />;`,
    );
    const logicalResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icon = Search || HomeIcon;
       const Toolbar = () => <Icon />;`,
    );
    expect(conditionalResult.diagnostics).toHaveLength(0);
    expect(logicalResult.diagnostics).toHaveLength(0);
  });

  it("tracks Object.assign and array push registry mutations", () => {
    const objectResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const Icons = { Search };
       Object.assign(Icons, { Search: HomeIcon });
       const Toolbar = () => <><Icons.Search /><Search /></>;`,
    );
    const arrayResult = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react";
       import { HomeIcon } from "@heroicons/react/24/outline";
       const icons = [Search];
       icons.push(HomeIcon);
       const Icon = icons[kind];
       const Toolbar = () => <Icon />;`,
    );
    expect(objectResult.diagnostics).toHaveLength(1);
    expect(arrayResult.diagnostics).toHaveLength(1);
  });

  it("allows brand logos alongside a UI icon family", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { GithubIcon } from "lucide-react";
       import { SiDiscord } from "react-icons/si";
       const SocialLinks = () => <><GithubIcon /><SiDiscord /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
