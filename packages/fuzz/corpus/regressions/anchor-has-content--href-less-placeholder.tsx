// rule: anchor-has-content
// weakness: semantic-provenance
// source: Hacker0x01/react-datepicker@548a1f3464c30741f2581c78f27fe1f20f9aeac6
export const YearNavigation = ({ incrementYears }: { incrementYears: () => void }) => (
  <div className="year-option" onClick={incrementYears}>
    <a className="navigation navigation-upcoming" />
  </div>
);

export const EmptyLink = () => <a href="/archive" />;
