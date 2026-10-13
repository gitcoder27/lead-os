// Shared across service instances in the single server process. Never hold a SQLite
// transaction across network I/O. Durable proposal CAS separately guards replay.
const mutations = new Map<number, Promise<unknown>>();

export async function withConversationMutation<T>(id: number, work: () => Promise<T>): Promise<T> {
  const previous = mutations.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  mutations.set(id, current);
  try { return await current; }
  finally { if (mutations.get(id) === current) mutations.delete(id); }
}
