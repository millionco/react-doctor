// rule: form-control-requires-name
// verdict: pass
// weakness: render-reachability

export const DetachedLogicalField = () => {
  const unusedForm = <form id="profile" />;
  return unusedForm && <input form="profile" />;
};
