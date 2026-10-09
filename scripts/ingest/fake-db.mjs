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
    async touchToken(hash, { seenAt, accepted }) {
      calls.push('touchToken')
      const row = tokenRows.get(hash)
      if (!row) return
      row.last_seen_at = seenAt
      row.accepted_total = (row.accepted_total ?? 0) + accepted
    },
    async deleteRepo(repo_id) {
      calls.push('deleteRepo')
      for (const [k, r] of reports) if (r.repo_id === repo_id) reports.delete(k)
      for (const [k, r] of tokenRows) if (r.repo_id === repo_id) tokenRows.delete(k)
    },
    async purgeExpired({ reportsBefore, tokensBefore, countersBefore }) {
      calls.push('purgeExpired')
      for (const [k, r] of reports) if (r.received_at < reportsBefore) reports.delete(k)
      for (const [k, r] of tokenRows) if ((r.last_seen_at ?? r.created_at) < tokensBefore) tokenRows.delete(k)
      for (const k of counters.keys()) if (k.split('|')[1] < countersBefore) counters.delete(k)
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
