// rule: no-mixed-icon-libraries
// weakness: copy-tracking
// source: 0.8.1-to-main all-rules parity adversarial review
// verdict: pass
import { HomeIcon } from "@heroicons/react/24/outline";
import { Search } from "lucide-react";

const BaseIcons = { Search, HomeIcon };
const Icons = { navigation: BaseIcons };

export const SearchControl = () => (
  <>
    <Icons.navigation.Search />
    <Search />
  </>
);
