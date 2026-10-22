import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { migrate, pool } from '../src/db.js'

// runs against a real Postgres test database (see TEST_DATABASE_URL in vitest.config.ts)
const app = createApp()

const rep = (n: number, good: boolean) => ({
    n,
    good,
    faults: good ? [] : ['Go lower, chest closer to the floor'],
    numbers: [{ label: 'depth', value: '48°' }],
    bottom: good ? 48 : 70,
    top: 165,
    line: good ? 'Good rep | depth 48°' : 'Go lower | depth 70°',
})

const session = { exercise: 'pushup', source: 'Live camera', reps: [rep(1, true), rep(2, false), rep(3, true)] }

// registers a user and returns an agent that keeps their sign-in cookie
async function signedIn(email = 'bora@example.com') {
    const agent = request.agent(app)
    await agent.post('/api/auth/register').send({ email, password: 'correct horse' }).expect(201)
    return agent
}

beforeAll(migrate)
beforeEach(() => pool.query('TRUNCATE users CASCADE'))
afterAll(() => pool.end())

describe('accounts', () => {
    it('registers, remembers the user, and signs out', async () => {
        const agent = await signedIn()
        const me = await agent.get('/api/auth/me').expect(200)
        expect(me.body.user.email).toBe('bora@example.com')

        await agent.post('/api/auth/logout').expect(204)
        await agent.get('/api/auth/me').expect(401)
    })

    it('stores a hashed password, never the password itself', async () => {
        await signedIn()
        const { rows } = await pool.query('SELECT password_hash FROM users')
        expect(rows[0].password_hash).not.toContain('correct horse')
        expect(rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/)
    })

    it('treats email case-insensitively and rejects duplicates', async () => {
        await signedIn('Bora@Example.com')
        await request(app)
            .post('/api/auth/register')
            .send({ email: 'bora@example.com', password: 'another one' })
            .expect(409)
        await request(app)
            .post('/api/auth/login')
            .send({ email: 'BORA@example.com', password: 'correct horse' })
            .expect(200)
    })

    it('rejects a short password and a bad email', async () => {
        await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'short' }).expect(400)
        await request(app).post('/api/auth/register').send({ email: 'not-an-email', password: 'long enough' }).expect(400)
    })

    it('gives the same error for a wrong password and an unknown email', async () => {
        await signedIn()
        const wrongPassword = await request(app)
            .post('/api/auth/login')
            .send({ email: 'bora@example.com', password: 'wrong password' })
            .expect(401)
        const unknownEmail = await request(app)
            .post('/api/auth/login')
            .send({ email: 'nobody@example.com', password: 'wrong password' })
            .expect(401)
        expect(wrongPassword.body).toEqual(unknownEmail.body)
    })

    it('rejects a forged token', async () => {
        await request(app).get('/api/auth/me').set('Cookie', 'formcheck_token=not.a.token').expect(401)
    })
})

describe('sessions', () => {
    it('needs a signed-in user', async () => {
        await request(app).get('/api/sessions').expect(401)
        await request(app).post('/api/sessions').send(session).expect(401)
    })

    it('saves a session and lists it with totals', async () => {
        const agent = await signedIn()
        const saved = await agent.post('/api/sessions').send(session).expect(201)

        const list = await agent.get('/api/sessions').expect(200)
        expect(list.body.sessions).toHaveLength(1)
        expect(list.body.sessions[0]).toMatchObject({
            id: saved.body.id,
            exercise: 'pushup',
            repCount: 3,
            goodCount: 2,
        })
        expect(list.body.sessions[0].avgBottom).toBeCloseTo((48 + 70 + 48) / 3)
    })

    it('returns every rep of a session in order', async () => {
        const agent = await signedIn()
        const saved = await agent.post('/api/sessions').send(session).expect(201)

        const one = await agent.get(`/api/sessions/${saved.body.id}`).expect(200)
        expect(one.body.session.reps.map((r: { n: number }) => r.n)).toEqual([1, 2, 3])
        expect(one.body.session.reps[1]).toMatchObject({
            good: false,
            faults: ['Go lower, chest closer to the floor'],
            numbers: [{ label: 'depth', value: '48°' }],
        })
    })

    it('filters the list by exercise, newest first', async () => {
        const agent = await signedIn()
        await agent.post('/api/sessions').send(session).expect(201)
        await agent.post('/api/sessions').send({ ...session, exercise: 'squat' }).expect(201)
        await agent.post('/api/sessions').send({ ...session, source: 'second.mp4' }).expect(201)

        const pushups = await agent.get('/api/sessions?exercise=pushup').expect(200)
        expect(pushups.body.sessions.map((s: { source: string }) => s.source)).toEqual(['second.mp4', 'Live camera'])
    })

    it("never shows or deletes another user's sessions", async () => {
        const bora = await signedIn('bora@example.com')
        const saved = await bora.post('/api/sessions').send(session).expect(201)

        const other = await signedIn('other@example.com')
        expect((await other.get('/api/sessions').expect(200)).body.sessions).toEqual([])
        await other.get(`/api/sessions/${saved.body.id}`).expect(404)
        await other.delete(`/api/sessions/${saved.body.id}`).expect(404)

        await bora.get(`/api/sessions/${saved.body.id}`).expect(200)
    })

    it('deletes a session and its reps', async () => {
        const agent = await signedIn()
        const saved = await agent.post('/api/sessions').send(session).expect(201)
        await agent.delete(`/api/sessions/${saved.body.id}`).expect(204)
        await agent.get(`/api/sessions/${saved.body.id}`).expect(404)
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM reps')
        expect(rows[0].n).toBe(0)
    })

    it('rejects bad input', async () => {
        const agent = await signedIn()
        await agent.post('/api/sessions').send({ ...session, reps: [] }).expect(400)
        await agent.post('/api/sessions').send({ ...session, reps: [{ n: 1 }] }).expect(400)
        await agent.get('/api/sessions/not-a-uuid').expect(404)
    })
})
