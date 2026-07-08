import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `<img>` (and object/area/input[type=image]) without a
// usable text alternative. Variants probe value shapes and attribute
// spellings around the "alt is present and valid" check.
export const altTextCases: FnMiningCase[] = [
  {
    ruleId: "alt-text",
    description: "canonical: <img> with no alt at all",
    filePath: "src/avatar.tsx",
    code: `const Avatar = ({ src }: { src: string }) => <img src={src} />;`,
    shouldFire: true,
  },
  {
    ruleId: "alt-text",
    description: "alt explicitly {undefined}",
    filePath: "src/avatar.tsx",
    code: `const Avatar = ({ src }: { src: string }) => <img src={src} alt={undefined} />;`,
    shouldFire: true,
  },
  {
    ruleId: "alt-text",
    description: "alt is a conditional that can evaluate to undefined",
    filePath: "src/avatar.tsx",
    code: `
      const Avatar = ({ src, label, isDecorative }: AvatarProps) => (
        <img src={src} alt={isDecorative ? undefined : label} />
      );
    `,
    shouldFire: true,
  },
  {
    ruleId: "alt-text",
    description: "aria-label is an empty string inside an expression container",
    filePath: "src/avatar.tsx",
    code: `const Avatar = ({ src }: { src: string }) => <img src={src} aria-label={""} />;`,
    shouldFire: true,
  },
  {
    ruleId: "alt-text",
    description: 'image button with uppercase type: <input type="IMAGE"> and no alt',
    filePath: "src/submit-button.tsx",
    code: `const Submit = () => <input type="IMAGE" src="/go.png" />;`,
    shouldFire: true,
  },
  {
    ruleId: "alt-text",
    description: "spread props on the <img> (deliberate carve-out: spread may carry alt)",
    filePath: "src/avatar.tsx",
    code: `const Avatar = (imageProps: ImageProps) => <img {...imageProps} />;`,
    shouldFire: false,
    carveOutReason:
      "A spread can carry `alt` — wrapper components typed as ImgHTMLAttributes forward it from callers, so the element can't be proven unlabeled (documented gate in the rule's JSXOpeningElement visitor).",
  },
  {
    ruleId: "alt-text",
    description: "alt explicitly {null}",
    filePath: "src/avatar.tsx",
    code: `const Avatar = ({ src }: { src: string }) => <img src={src} alt={null} />;`,
    shouldFire: true,
  },
];
