const waitForAll = async <T>(operations: Array<Promise<T>>): Promise<T[]> => {
  const settled = await Promise.allSettled(operations)
  const values: T[] = []
  for (const result of settled) {
    if (result.status === 'rejected') throw result.reason
    values.push(result.value)
  }
  return values
}

export async function runBatch(ids: string[], operation: (id: string) => Promise<void>): Promise<void> {
  await waitForAll(ids.map(async (id) => {
    await operation(id)
  }))
}
