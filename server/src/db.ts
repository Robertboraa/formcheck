import pg from 'pg'
import { readFile } from 'node:fs/promises'

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/formcheck',
})

// creates the tables if they don't exist yet
export async function migrate() {
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
    await pool.query(sql)
}
