import { useState, type FormEvent } from 'react'
import { api, type User } from './api'

type Props = {
    onSignedIn: (user: User) => void
    onCancel: () => void
}

function Auth({ onSignedIn, onCancel }: Props) {
    const [mode, setMode] = useState<'login' | 'register'>('login')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setError('')
        setBusy(true)
        try {
            const user = mode === 'login' ? await api.login(email, password) : await api.register(email, password)
            onSignedIn(user)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong')
        } finally {
            setBusy(false)
        }
    }

    return (
        <main className="auth">
            <form className="card auth-card" onSubmit={submit}>
                <h2>{mode === 'login' ? 'Sign in' : 'Start tracking your progress'}</h2>
                <p className="muted">
                    Your sessions are saved so you can compare them over time. Only the rep numbers are stored, never
                    your video.
                </p>

                <label className="field">
                    <span>Email</span>
                    <input
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </label>
                <label className="field">
                    <span>Password</span>
                    <input
                        type="password"
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        required
                        minLength={mode === 'register' ? 8 : undefined}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                    {mode === 'register' && <small className="muted">At least 8 characters</small>}
                </label>

                {error && <p className="form-error">{error}</p>}

                <button className="btn primary big" disabled={busy}>
                    {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
                </button>

                <p className="muted switch">
                    {mode === 'login' ? 'New here?' : 'Already have an account?'}{' '}
                    <button
                        type="button"
                        className="link"
                        onClick={() => {
                            setMode(mode === 'login' ? 'register' : 'login')
                            setError('')
                        }}
                    >
                        {mode === 'login' ? 'Create an account' : 'Sign in'}
                    </button>
                </p>
                <button type="button" className="link muted" onClick={onCancel}>
                    Continue without an account
                </button>
            </form>
        </main>
    )
}

export default Auth
