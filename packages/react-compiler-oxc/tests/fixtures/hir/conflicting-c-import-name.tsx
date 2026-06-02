import {useMemo} from 'react';
import {ValidateMemoization} from 'shared-runtime';

function Component(props) {
  const _c = props.a;
  const array = useMemo(() => [_c], [_c]);
  return <ValidateMemoization inputs={[_c]} output={array} />;
}

export const FIXTURE_ENTRYPOINT = {
  fn: Component,
  params: [{a: 1}],
};
