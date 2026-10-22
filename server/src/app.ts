import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { authRouter } from './auth.js'
import { sessionsRouter } from './sessions.js'

declare module 'express-serve-static-core' {
    interface Request {
        userId?: string
    }
}

export function createApp() {
    const app = express()
    app.use(helmet())
    app.use(express.json({ limit: '1mb' }))
    app.use(cookieParser())

    app.get('/api/health', (_req, res) => res.json({ ok: true }))
    app.use('/api/auth', authRouter)
    app.use('/api/sessions', sessionsRouter)

    app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))

    // anything that throws ends up here: log it, and don't leak details to the client
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        console.error(err)
        res.status(500).json({ error: 'Something went wrong' })
    })

    return app
}
