import { Router } from 'express'
import { z } from 'zod'
import { pool } from './db.js'
import { requireUser } from './auth.js'

// the shape of one rep, matching the Rep type in the app
const rep = z.object({
    n: z.number().int().positive(),
    good: z.boolean(),
    faults: z.array(z.string().max(300)).max(10),
    numbers: z.array(z.object({ label: z.string().max(40), value: z.string().max(40) })).max(20),
    bottom: z.number().finite(),
    top: z.number().finite(),
    line: z.string().max(2000),
})

const newSession = z.object({
    exercise: z.string().min(1).max(40),
    source: z.string().min(1).max(200),
    reps: z.array(rep).min(1).max(500),
})

const uuid = z.uuid()

export const sessionsRouter = Router()
sessionsRouter.use(requireUser)

// save a finished session and all its reps in one transaction
sessionsRouter.post('/', async (req, res) => {
    const parsed = newSession.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const { exercise, source, reps } = parsed.data

    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const session = await client.query(
            'INSERT INTO sessions (user_id, exercise, source) VALUES ($1, $2, $3) RETURNING id, created_at',
            [req.userId, exercise, source],
        )
        const id = session.rows[0].id
        await client.query(
            `INSERT INTO reps (session_id, n, good, faults, numbers, bottom, top, line)
             SELECT $1, r.n, r.good, ARRAY(SELECT jsonb_array_elements_text(r.faults)), r.numbers, r.bottom, r.top, r.line
             FROM jsonb_to_recordset($2::jsonb)
                 AS r(n int, good boolean, faults jsonb, numbers jsonb, bottom real, top real, line text)`,
            [id, JSON.stringify(reps)],
        )
        await client.query('COMMIT')
        res.status(201).json({ id, createdAt: session.rows[0].created_at })
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
})

// list the user's sessions, newest first, with totals for the history page
sessionsRouter.get('/', async (req, res) => {
    const exercise = typeof req.query.exercise === 'string' ? req.query.exercise : null
    const result = await pool.query(
        `SELECT s.id, s.exercise, s.source, s.created_at AS "createdAt",
                count(r.n)::int AS "repCount",
                count(r.n) FILTER (WHERE r.good)::int AS "goodCount",
                avg(r.bottom)::real AS "avgBottom"
         FROM sessions s
         JOIN reps r ON r.session_id = s.id
         WHERE s.user_id = $1 AND ($2::text IS NULL OR s.exercise = $2)
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT 200`,
        [req.userId, exercise],
    )
    res.json({ sessions: result.rows })
})

// one session with every rep
sessionsRouter.get('/:id', async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'Session not found' })
    const session = await pool.query(
        `SELECT id, exercise, source, created_at AS "createdAt" FROM sessions WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.userId],
    )
    if (session.rowCount === 0) return res.status(404).json({ error: 'Session not found' })
    const reps = await pool.query(
        'SELECT n, good, faults, numbers, bottom, top, line FROM reps WHERE session_id = $1 ORDER BY n',
        [req.params.id],
    )
    res.json({ session: { ...session.rows[0], reps: reps.rows } })
})

sessionsRouter.delete('/:id', async (req, res) => {
    if (!uuid.safeParse(req.params.id).success) return res.status(404).json({ error: 'Session not found' })
    const result = await pool.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [
        req.params.id,
        req.userId,
    ])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' })
    res.status(204).end()
})
