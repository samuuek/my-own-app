import { resolve } from 'node:path'
import { createDatabase } from './database.mjs'
import { createApiServer } from './http.mjs'

const host = process.env.SIYU_HOST || '127.0.0.1'
const port = Number(process.env.SIYU_PORT || 8787)
const databaseFile = process.env.SIYU_DATABASE || resolve('data', 'siyu.db')
const store = createDatabase(databaseFile)
const server = createApiServer({ store, env: process.env, distDir: resolve('dist') })

server.listen(port, host, () => console.log(`思屿后端已启动：http://${host}:${port}`))

function shutdown() { server.close(() => { store.close(); process.exit(0) }) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
