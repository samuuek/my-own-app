import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npm, ['run', 'dev:server'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'dev:frontend', '--', '--host', '127.0.0.1'], { stdio: 'inherit' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill()
  setTimeout(() => process.exit(code), 100).unref()
}

for (const child of children) child.on('exit', code => { if (!stopping && code) stop(code) })
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
