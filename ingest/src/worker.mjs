// Thin edge entry: adapts D1 to the storage port handler.mjs is injected with.
// Keep it free of logic so everything testable lives in handler.mjs.
import { handle, sweep } from './handler.mjs'

export const d1Port = (d1) => ({
  async getToken(hash) {
    return d1.prepare('SELECT repo_id FROM tokens WHERE token_hash = ?').bind(hash).first()
  },
  async insertToken(hash, { repo_id, created_at }) {
    await d1.prepare('INSERT INTO tokens (token_hash, repo_id, created_at) VALUES (?, ?, ?)').bind(hash, repo_id, created_at).run()
  },
  async getCounter(key, day) {
    const row = await d1.prepare('SELECT n FROM counters WHERE key = ? AND day = ?').bind(key, day).first()
    return row?.n ?? 0
  },
  async incCounter(key, day, by = 1) {
    const row = await d1
      .prepare('INSERT INTO counters (key, day, n) VALUES (?, ?, ?) ON CONFLICT (key, day) DO UPDATE SET n = n + excluded.n RETURNING n')
      .bind(key, day, by)
      .first()
    return row.n
  },
  async touchToken(hash, { seenAt, accepted }) {
    await d1
      .prepare('UPDATE tokens SET last_seen_at = ?, accepted_total = accepted_total + ? WHERE token_hash = ?')
      .bind(seenAt, accepted, hash)
      .run()
  },
  async deleteRepo(repo_id) {
    await d1.batch([
      d1.prepare('DELETE FROM reports WHERE repo_id = ?').bind(repo_id),
      d1.prepare('DELETE FROM tokens WHERE repo_id = ?').bind(repo_id),
    ])
  },
  async purgeExpired({ reportsBefore, tokensBefore, countersBefore }) {
    await d1.batch([
      d1.prepare('DELETE FROM reports WHERE received_at < ?').bind(reportsBefore),
      d1.prepare('DELETE FROM tokens WHERE COALESCE(last_seen_at, created_at) < ?').bind(tokensBefore),
      d1.prepare('DELETE FROM counters WHERE day < ?').bind(countersBefore),
    ])
  },
  // First write wins on (run_id, sessions); false means the row already existed.
  async insertReport(row) {
    const res = await d1
      .prepare(
        'INSERT OR IGNORE INTO reports (run_id, sessions, repo_id, token_hash, received_at, schema, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(row.run_id, row.sessions, row.repo_id, row.token_hash, row.received_at, row.schema, row.body)
      .run()
    return res.meta.changes > 0
  },
})

export default {
  fetch: (request, env) => handle(request, { db: d1Port(env.DB), now: () => new Date(), env }),
  scheduled: (event, env, ctx) => {
    ctx.waitUntil(sweep({ db: d1Port(env.DB), now: () => new Date() }))
  },
}
