export const loadRecords = (context, query) =>
  context.api.records.find(query).then((records) => records);
