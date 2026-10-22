// Talks to the FormCheck API in server/. In development Vite forwards /api to it.
import type { Rep } from './exercises'

export type User = { id: string; email: string }

export type SessionSummary = {
    id: string
    exercise: string
    source: string
    createdAt: string
    repCount: number
    goodCount: number
    avgBottom: number
}

export type SavedSession = {
    id: string
    exercise: string
    source: string
    createdAt: string
    reps: Rep[]
}

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`/api${path}`, {
        ...options,
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    })
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
    return data as T
}

export const api = {
    me: () => call<{ user: User }>('/auth/me').then((d) => d.user),
    register: (email: string, password: string) =>
        call<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }).then(
            (d) => d.user,
        ),
    login: (email: string, password: string) =>
        call<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }).then(
            (d) => d.user,
        ),
    logout: () => call<void>('/auth/logout', { method: 'POST' }),

    saveSession: (exercise: string, source: string, reps: Rep[]) =>
        call<{ id: string }>('/sessions', { method: 'POST', body: JSON.stringify({ exercise, source, reps }) }),
    sessions: (exercise?: string) =>
        call<{ sessions: SessionSummary[] }>(
            exercise ? `/sessions?exercise=${encodeURIComponent(exercise)}` : '/sessions',
        ).then((d) => d.sessions),
    session: (id: string) => call<{ session: SavedSession }>(`/sessions/${id}`).then((d) => d.session),
    deleteSession: (id: string) => call<void>(`/sessions/${id}`, { method: 'DELETE' }),
}

// percentage of good reps in a session
export function scoreOf(s: { repCount: number; goodCount: number }) {
    return s.repCount ? Math.round((s.goodCount / s.repCount) * 100) : 0
}

export function formatDate(iso: string) {
    return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    })
}
