// rule: jsx-no-jsx-as-prop
// weakness: slot-name coverage
// source: fuzz FP hunt 2026-07 (material-ui ListItem leftAvatar/primaryText/
// secondaryText, supabase ChartContent loadingState/disabledState, leemons
// leftZone/rightZone, capitalised Footer slot — all conventional JSX slots)
declare const ListItem: (props: {
  leftAvatar?: unknown;
  primaryText?: unknown;
  secondaryText?: unknown;
}) => null;
declare const ChartContent: (props: { loadingState?: unknown; disabledState?: unknown }) => null;
declare const FooterContainer: (props: { leftZone?: unknown; rightZone?: unknown }) => null;
declare const StepContainer: (props: { Footer?: unknown }) => null;
declare const Avatar: (props: { src: string }) => null;
declare const user: { image: string; name: string; bio: string };

export const SlotConsumers = () => (
  <>
    <ListItem
      leftAvatar={<Avatar src={user.image} />}
      primaryText={<b>{user.name}</b>}
      secondaryText={<i>{user.bio}</i>}
    />
    <ChartContent loadingState={<span>loading</span>} disabledState={<span>disabled</span>} />
    <FooterContainer
      leftZone={<button type="button">back</button>}
      rightZone={<button type="button">next</button>}
    />
    <StepContainer Footer={<footer>done</footer>} />
  </>
);
