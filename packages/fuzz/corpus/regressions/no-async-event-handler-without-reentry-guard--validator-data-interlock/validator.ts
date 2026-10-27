interface Fields {
  ready: boolean;
}

interface Issues {
  readiness?: string;
}

export default (fields: Fields) => {
  const issues: Issues = {};
  if (!fields.ready) issues.readiness = "Busy";
  return issues;
};
