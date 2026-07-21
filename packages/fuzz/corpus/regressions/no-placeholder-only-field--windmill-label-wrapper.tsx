// rule: no-placeholder-only-field
// weakness: library-idiom
// source: RDE OSS corpus, estevanmaito/windmill-dashboard-react
// verdict: pass

import { Label as FieldLabel } from "@windmill/react-ui";

export const SearchField = () => (
  <FieldLabel>
    <span>Search</span>
    <div>
      <input placeholder="Search projects" />
    </div>
  </FieldLabel>
);
