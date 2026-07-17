const ICON_LIBRARY_PACKAGES: ReadonlyArray<string> = [
  "lucide-react",
  "lucide-react-native",
  "react-feather",
  "phosphor-react",
  "iconoir-react",
  "react-bootstrap-icons",
  "@heroicons/react",
  "@tabler/icons-react",
  "@phosphor-icons/react",
  "@radix-ui/react-icons",
  "@mui/icons-material",
  "@ant-design/icons",
  "@primer/octicons-react",
];

export const getIconLibraryFamily = (source: string): string | null => {
  if (source === "react-icons") return source;
  if (source.startsWith("react-icons/")) return source.split("/").slice(0, 2).join("/");
  if (
    source === "@fortawesome/react-fontawesome" ||
    /^@fortawesome\/free-[^/]+-svg-icons(?:\/|$)/.test(source)
  ) {
    return "@fortawesome";
  }
  return (
    ICON_LIBRARY_PACKAGES.find(
      (packageName) => source === packageName || source.startsWith(`${packageName}/`),
    ) ?? null
  );
};
