import { useState } from 'react'
import { api } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Badge, Card, Empty, Field, Loading, useAction, useLoad } from '../components/ui'

const ROLES = ['admin', 'teacher', 'student', 'parent']
const blank = { name: '', email: '', password: '', role: 'teacher', admission_no: '', class_id: '', roll_no: '' }

export default function Users() {
  const { user: me } = useApp()
  const [tab, setTab] = useState('')
  const users = useLoad(() => api.get(`/api/users${tab ? `?role=${tab}` : ''}`), [tab])
  const classes = useLoad(() => api.get('/api/classes'))
  const parents = useLoad(() => api.get('/api/users?role=parent'))
  const roster = useLoad(() => api.get('/api/students'))
  const [form, setForm] = useState(blank)
  const [linking, setLinking] = useState(null) // student row being linked
  const [picked, setPicked] = useState([])
  const create = useAction()
  const row = useAction()
  const link = useAction()
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    const body = { name: form.name, email: form.email, password: form.password, role: form.role }
    if (form.role === 'student') body.student = { admission_no: form.admission_no, class_id: form.class_id ? Number(form.class_id) : null, roll_no: form.roll_no ? Number(form.roll_no) : null }
    const ok = await create.run(() => api.post('/api/users', body), 'Account created')
    if (ok) { setForm(blank); users.reload(); roster.reload(); parents.reload() }
  }
  const patch = (id, body, msg) => row.run(() => api.patch(`/api/users/${id}`, body), msg).then(() => users.reload())

  async function resetPassword(u) {
    const pw = window.prompt(`New password for ${u.name} (min 8 characters):`)
    if (pw) patch(u.id, { password: pw }, 'Password reset')
  }
  async function remove(u) {
    if (!window.confirm(`Permanently delete ${u.name}? All of their records are removed.`)) return
    await row.run(() => api.del(`/api/users/${u.id}`), 'User deleted')
    users.reload(); roster.reload()
  }
  function startLink(u) {
    const s = (roster.data || []).find((x) => x.user_id === u.id)
    setLinking({ ...u, studentId: s?.id })
    setPicked((s?.parents || []).map((p) => p.id))
  }
  async function saveLinks() {
    const ok = await link.run(() => api.put(`/api/users/students/${linking.studentId}/parents`, { parentIds: picked }), 'Parents linked')
    if (ok) { roster.reload(); setLinking(null) }
  }

  return (
    <>
      <h1>Users</h1>
      <Card title="Create account">
        <form className="form" onSubmit={submit}>
          <Field label="Full name"><input required value={form.name} onChange={set('name')} /></Field>
          <Field label="Email"><input type="email" required value={form.email} onChange={set('email')} /></Field>
          <Field label="Temporary password"><input type="text" required minLength={8} value={form.password} onChange={set('password')} /></Field>
          <Field label="Role"><select value={form.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
          {form.role === 'student' && (
            <>
              <Field label="Admission no."><input required value={form.admission_no} onChange={set('admission_no')} /></Field>
              <Field label="Class">
                <select value={form.class_id} onChange={set('class_id')}>
                  <option value="">— none —</option>
                  {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
                </select>
              </Field>
              <Field label="Roll no."><input type="number" min="1" value={form.roll_no} onChange={set('roll_no')} /></Field>
            </>
          )}
          <button className="btn" disabled={create.busy}>Create</button>
        </form>
        <Alert>{create.error}</Alert>
        <Alert kind="ok">{create.ok}</Alert>
      </Card>

      <Card title="All users">
        <div className="tabs">
          {['', ...ROLES].map((r) => <button key={r} className={tab === r ? 'on' : ''} onClick={() => setTab(r)}>{r || 'all'}</button>)}
        </div>
        <Loading state={users} />
        <Alert>{row.error}</Alert>
        {users.data?.length === 0 && <Empty>No users.</Empty>}
        {users.data?.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.data.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}{u.admission_no && <span className="muted"> · {u.admission_no}</span>}</td>
                    <td>{u.email}</td>
                    <td>
                      <select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.id === me.id || u.role === 'student'}
                        onChange={(e) => patch(u.id, { role: e.target.value }, 'Role updated')}>
                        {ROLES.filter((r) => u.role === 'student' ? r === 'student' : r !== 'student').map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </td>
                    <td><Badge tone={u.active ? 'ok' : 'bad'}>{u.active ? 'active' : 'deactivated'}</Badge></td>
                    <td className="row">
                      {u.role === 'student' && <button className="btn ghost small" onClick={() => startLink(u)}>Parents</button>}
                      <button className="btn ghost small" onClick={() => resetPassword(u)}>Reset password</button>
                      {u.id !== me.id && <button className="btn ghost small" onClick={() => patch(u.id, { active: !u.active }, u.active ? 'Deactivated' : 'Activated')}>{u.active ? 'Deactivate' : 'Activate'}</button>}
                      {u.id !== me.id && <button className="btn danger small" onClick={() => remove(u)}>Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {linking && (
        <Card title={`Parents of ${linking.name}`} actions={<button className="btn ghost small" onClick={() => setLinking(null)}>Close</button>}>
          {(parents.data || []).length === 0 && <Empty>No parent accounts exist yet. Create one above.</Empty>}
          {(parents.data || []).map((p) => (
            <label key={p.id} className="row">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
              {p.name} <span className="muted">{p.email}</span>
            </label>
          ))}
          <Alert>{link.error}</Alert>
          <p><button className="btn" disabled={link.busy} onClick={saveLinks}>Save links</button></p>
        </Card>
      )}
    </>
  )
}
