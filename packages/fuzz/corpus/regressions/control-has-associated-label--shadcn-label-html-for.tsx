// rule: control-has-associated-label
// weakness: library-idiom
// source: GitHub issue #1314

import { Label } from "@/components/ui/label";

export const DepartmentSelect = () => (
  <div>
    <Label htmlFor="departmentId">Department</Label>
    <select id="departmentId" name="departmentId">
      <option value="">All</option>
    </select>
  </div>
);
