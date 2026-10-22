import 'dotenv/config'
import { migrate, pool } from './db.js'

await migrate()
console.log('Database is up to date')
await pool.end()
