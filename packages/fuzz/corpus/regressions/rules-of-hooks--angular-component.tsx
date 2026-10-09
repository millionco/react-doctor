// rule: rules-of-hooks
// verdict: pass
import { Component } from "@angular/core";
import { useLabel } from "./label";
@Component({})
class LabelView {
  label = useLabel();
}
