// rule: rn-list-recyclable-without-types
// weakness: control-flow
// source: Cursor Bugbot review on PR #1427
// verdict: pass

import { FlashList } from "@shopify/flash-list";

const Header = () => null;
const Row = () => null;

export const ShortCircuitRows = ({ condition, items }) => (
  <>
    <FlashList data={items} recycleItems renderItem={() => <Header /> && <Row />} />
    <FlashList data={items} recycleItems renderItem={() => <Header /> || <Row />} />
    <FlashList data={items} recycleItems renderItem={() => <Header /> ?? <Row />} />
    <FlashList data={items} recycleItems renderItem={() => condition && <Header /> && <Row />} />
    <FlashList data={items} recycleItems renderItem={() => condition || <Header /> || <Row />} />
    <FlashList data={items} recycleItems renderItem={() => condition ?? <Header /> ?? <Row />} />
  </>
);
