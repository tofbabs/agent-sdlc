#!/usr/bin/env node
// connection-recorder.mjs — a loopback listener that records every connection,
// so a test can prove an export path stayed silent. Shared by any test that
// points AGENTIC_SDLC_EXPORT_URL at it.
//
// usage: connection-recorder.mjs <portfile> <connfile>
//   portfile — written once the listener is bound (poll for it)
//   connfile — one line appended per accepted connection; count lines to assert
//
// Bound to 127.0.0.1 only: a recorder reachable from outside would make a test
// pass or fail on someone else's traffic. It exits on SIGTERM and on its own
// after 120s so a crashed test never leaks a listener.
import { createServer } from 'node:net'
import { appendFileSync, writeFileSync } from 'node:fs'

const [portFile, connFile] = process.argv.slice(2)
if (!portFile || !connFile) {
  process.stderr.write('usage: connection-recorder.mjs <portfile> <connfile>\n')
  process.exit(2)
}

writeFileSync(connFile, '')
const server = createServer((socket) => {
  appendFileSync(connFile, 'connection\n')
  // Answer nothing: a client that connects here should fail loudly, not succeed.
  socket.destroy()
})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port))
})
setTimeout(() => process.exit(0), 120_000).unref()
process.on('SIGTERM', () => process.exit(0))
