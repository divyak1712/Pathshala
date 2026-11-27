import { useState } from 'react'
import { authClient } from '../lib/auth-client'
import { useApp } from '../lib/app-context'
import { Alert, Card, Field, useAction } from '../components/ui'

export default function Profile() {
  const { user } = useApp()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const act = useAction()

  async function submit(e) {
    e.preventDefault()
    const ok = await act.run(async () => {
      if (next.length < 8) throw new Error('New password must be at least 8 characters')
      const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
      if (error) throw new Error(error.message || 'Could not change password')
    }, 'Password updated')
    if (ok) { setCurrent(''); setNext('') }
  }

  return (
    <>
      <h1>My profile</h1>
      <Card title="Account">
        <p><strong>{user.name}</strong><br /><span className="muted">{user.email} · {user.role}</span></p>
      </Card>
      <Card title="Change password">
        <form className="form" onSubmit={submit}>
          <Field label="Current password"><input type="password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="New password (min 8)"><input type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <button className="btn" disabled={act.busy}>Update password</button>
        </form>
        <Alert>{act.error}</Alert>
        <Alert kind="ok">{act.ok}</Alert>
      </Card>
    </>
  )
}
