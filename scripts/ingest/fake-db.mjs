// In-memory stand-in for the storage port handler.mjs is injected with. Every
// call is logged so tests can prove an early rejection never reached storage,
// not merely that nothing was stored.
export function fakeDb({ tokens = {} } = {}) {
  const reports = new Map()
  const counters = new Map()
  const calls = []
  const tokenRows = new Map(Object.entries(tokens))
  const ck = (key, day) => `${key}|${day}`
  return {
    reports,
    counters,
    calls,
    writes: () => calls.filter((c) => c === 'insertReport' || c === 'incCounter'),
    async getToken(hash) {
      calls.push('getToken')
      return tokenRows.get(hash) ?? null
    },
    // Stores only what the port is handed; tests assert no raw token or IP lands here.
    async insertToken(hash, row) {
      calls.push('insertToken')
      tokenRows.set(hash, row)
    },
    tokenRows,
    async getCounter(key, day) {
      calls.push('getCounter')
      return counters.get(ck(key, day)) ?? 0
    },
    async incCounter(key, day, by = 1) {
      calls.push('incCounter')
      const n = (counters.get(ck(key, day)) ?? 0) + by
      counters.set(ck(key, day), n)
      return n
    },
    // Resolves false on a (run_id, sessions) collision: first write wins.
    async insertReport(row) {
      calls.push('insertReport')
      const k = `${row.run_id}|${row.sessions}`
      if (reports.has(k)) return false
      reports.set(k, row)
      return true
    },
  }
}
