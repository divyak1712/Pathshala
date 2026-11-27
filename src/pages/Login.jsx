import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { signIn } from '../lib/auth-client'
import { useApp } from '../lib/app-context'
import { Alert, Field } from '../components/ui'

export default function Login() {
  const { signedIn } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (signedIn) return <Navigate to={location.state?.from || '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await signIn.email({ email, password })
    setBusy(false)
    if (err) return setError(err.message || 'Invalid email or password')
    navigate(location.state?.from || '/', { replace: true })
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={submit}>
        <h1>Pathshala</h1>
        <p className="muted">Sign in to your school account. Accounts are created by your school administrator.</p>
        <div className="form">
          <Field label="Email"><input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Alert>{error}</Alert>
          <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  )
}
