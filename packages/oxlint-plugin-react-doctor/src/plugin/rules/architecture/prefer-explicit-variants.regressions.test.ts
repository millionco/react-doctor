import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferExplicitVariants } from "./prefer-explicit-variants.js";

const run = (code: string) => runRule(preferExplicitVariants, code, { filename: "fixture.tsx" });

describe("architecture/prefer-explicit-variants — regressions", () => {
  // Docs-validation FP (hyperdx FilterGroupActions): boolean toggles that
  // swap paired icons inside independent action buttons are ordinary
  // toggle UI, not mutually-exclusive component variants.
  it("does not count boolean-driven icon swaps", () => {
    const result = run(
      `const FilterGroupActions = ({ showDistributions, isColumnDisplayed }) => (
        <div>
          <button>{showDistributions ? <IconChartBarOff size={14} /> : <IconChartBar size={14} />}</button>
          <button>{isColumnDisplayed ? <IconMinus size={14} /> : <IconPlus size={14} />}</button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not count `*Icon`-suffixed swaps either", () => {
    const result = run(
      `const Toggle = ({ isMuted, showBadge }) => (
        <div>
          {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          {showBadge ? <BadgeOnIcon /> : <BadgeOffIcon />}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation FP (pwa-kit OrderSummary): `isEstimate` picks between
  // two <Text> labels — a same-element content pick, not a variant switch.
  it("does not count a ternary whose arms render the same element", () => {
    const result = run(
      `const OrderSummary = ({ showPromoCodeForm, isEstimate }) => (
        <div>
          {showPromoCodeForm ? <Box><PromoCode /></Box> : <Divider />}
          {isEstimate ? <Text>Estimated Total</Text> : <Text>Order Total</Text>}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation FP (cboard BoardShare): `!isPublic` picks between two
  // <FormattedMessage> labels inside a button; only `isLogged` genuinely
  // switches subtrees, which is below the two-prop threshold.
  it("does not count same-element message swaps toward the threshold", () => {
    const result = run(
      `const BoardShare = ({ isLogged, isPublic }) => (
        <div>
          {isLogged ? (
            <PremiumFeature>
              <button>publish</button>
            </PremiumFeature>
          ) : (
            <LoginPrompt />
          )}
          <button>{!isPublic ? <FormattedMessage id="publish" /> : <FormattedMessage id="unpublish" />}</button>
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // The documented TP shape must keep firing: two boolean props each
  // selecting between DIFFERENT components.
  it("still flags two boolean props switching distinct component subtrees", () => {
    const result = run(
      `const Composer = ({ isThread, isEditing }) => (
        <div>
          {isThread ? <ThreadHeader /> : <ChannelHeader />}
          {isEditing ? <EditForm /> : <MessageContent />}
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags variant switches whose arms have children", () => {
    const result = run(
      `const Panel = ({ isCompact, hasSidebar }) => (
        <div>
          {isCompact ? <Compact><Summary /></Compact> : <Expanded><Details /></Expanded>}
          {hasSidebar ? <WithSidebar><Nav /></WithSidebar> : <FullWidth><Main /></FullWidth>}
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
