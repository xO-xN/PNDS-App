// Optional Host diagnostics only. Admission and musical state remain owned by
// the existing players policy; this list never contains recovery claim tokens.
export function createHostPerformers() {
  const clients = new Map()
  const isTestClient = value => typeof value === 'string' &&
    /^performer-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  return {
    joined(id, payload) {
      clients.set(id, {
        id,
        label: 'Performer',
        testClient: isTestClient(payload?.testClient) ? payload.testClient : null,
      })
    },
    controls(id, payload) {
      const client = clients.get(id)
      if (client && Number.isInteger(payload?.number) && payload.number >= 1 && payload.number <= 9)
        client.label = `Performer ${payload.number}`
    },
    released(id) { clients.delete(id) },
    snapshot() {
      return { schemaVersion: 1, clients: [...clients.values()].map(client => ({ ...client })) }
    },
  }
}
