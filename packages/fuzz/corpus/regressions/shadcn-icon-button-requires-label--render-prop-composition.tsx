// rule: shadcn-icon-button-requires-label
// verdict: pass
// weakness: wrapper-transparency
// source: /tmp/ui-corpus hunt (TanStack Table kitchen-sink-shadcn-base mode-toggle and dialog close button)
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Moon, Sun, XIcon } from "lucide-react";

export const ModeToggle = () => (
  <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="outline" size="icon" className="relative" />}>
      <Sun className="size-4" />
      <Moon className="absolute size-4" />
      <span className="sr-only">Toggle theme</span>
    </DropdownMenuTrigger>
  </DropdownMenu>
);

export const CloseSlot = ({ Close }: { Close: (props: { render: unknown }) => null }) => (
  <Close render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />} />
);

export const HiddenLabelSibling = () => (
  <button type="button">
    <XIcon />
    <span className="sr-only">Close</span>
  </button>
);

export const SlottedRemove = () => (
  <Button slot="remove" variant="ghost" size="icon-xs">
    <XIcon />
  </Button>
);
