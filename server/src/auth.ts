import { Router, type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { pool } from './db.js'

const COOKIE = 'formcheck_token'
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

function secret() {
    const value = process.env.JWT_SECRET
    if (!value) throw new Error('JWT_SECRET is not set')
    return value
}

const credentials = z.object({
    email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
    password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})

// signs the user in by putting a token in an http-only cookie the page's JavaScript can't read
function setSession(res: Response, userId: string) {
    const token = jwt.sign({ sub: userId }, secret(), { expiresIn: '30d' })
    res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: THIRTY_DAYS,
    })
}

// routes after this need a signed-in user; puts their id on req.userId
export function requireUser(req: Request, res: Response, next: NextFunction) {
    const token = req.cookies?.[COOKIE]
    if (!token) return res.status(401).json({ error: 'Not signed in' })
    try {
        const payload = jwt.verify(token, secret()) as { sub: string }
        req.userId = payload.sub
        next()
    } catch {
        res.status(401).json({ error: 'Not signed in' })
    }
}

export const authRouter = Router()

// slows down password guessing: 20 attempts per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
})

authRouter.post('/register', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message })
    const { email, password } = parsed.data

    const hash = await bcrypt.hash(password, 12)
    const result = await pool.query(
        `INSERT INTO users (email, password_hash) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email`,
        [email, hash],
    )
    if (result.rowCount === 0) return res.status(409).json({ error: 'An account with this email already exists' })

    const user = result.rows[0]
    setSession(res, user.id)
    res.status(201).json({ user })
})

authRouter.post('/login', limiter, async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) return res.status(401).json({ error: 'Wrong email or password' })
    const { email, password } = parsed.data

    const result = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email])
    const row = result.rows[0]
    // same message whether the email or the password is wrong, so emails can't be discovered
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        return res.status(401).json({ error: 'Wrong email or password' })
    }

    setSession(res, row.id)
    res.json({ user: { id: row.id, email: row.email } })
})

authRouter.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE)
    res.status(204).end()
})

authRouter.get('/me', requireUser, async (req, res) => {
    const result = await pool.query('SELECT id, email FROM users WHERE id = $1', [req.userId])
    if (result.rowCount === 0) return res.status(401).json({ error: 'Not signed in' })
    res.json({ user: result.rows[0] })
})
