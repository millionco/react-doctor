// rule: rules-of-hooks
// weakness: import-provenance
// source: infinitered/ChainReactApp2019 9dcc2a2b460f35607099c8f563048692f740ed80
import Tron from "reactotron-react-native";
import { mst } from "reactotron-mst";

declare const withCustomActions: () => unknown;

export class ReactotronService {
  setup() {
    Tron.useReactNative({ asyncStorage: false });
    Tron.use(mst({ filter: () => true }));
    Tron.use(withCustomActions());
  }
}
