import { useState } from 'react'
import { api } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Badge, Card, Empty, Field, Loading, useAction, useLoad } from '../components/ui'

export default function Announcements() {
  const { role } = useApp()
  const canPost = role === 'admin' || role === 'teacher'
  const list = useLoad(() => api.get('/api/announcements'))
  const classes = useLoad(() => (canPost ? api.get('/api/classes') : Promise.resolve([])), [canPost])
  const [f, setF] = useState({ title: '', body: '', audience: 'all', class_id: '' })
  const post = useAction()
  const del = useAction()

  async function submit(e) {
    e.preventDefault()
    const ok = await post.run(() => api.post('/api/announcements', { ...f, class_id: f.class_id ? Number(f.class_id) : null }), 'Announcement published')
    if (ok) { setF({ ...f, title: '', body: '' }); list.reload() }
  }

  return (
    <>
      <h1>Announcements</h1>
      {canPost && (
        <Card title="New announcement">
          <form className="form" onSubmit={submit}>
            <Field label="Audience">
              <select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
                <option value="all">Everyone</option>
                {role === 'admin' && <option value="teacher">Teachers</option>}
                <option value="student">Students</option>
                <option value="parent">Parents</option>
              </select>
            </Field>
            <Field label={role === 'teacher' ? 'Class' : 'Class (optional)'}>
              <select required={role === 'teacher'} value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>
                {role === 'admin' && <option value="">Whole school</option>}
                {role === 'teacher' && <option value="">Select…</option>}
                {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
              </select>
            </Field>
            <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Message"><textarea required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
            <button className="btn" disabled={post.busy}>Publish</button>
          </form>
          <Alert>{post.error}</Alert>
          <Alert kind="ok">{post.ok}</Alert>
        </Card>
      )}
      <Loading state={list} />
      <Alert>{del.error}</Alert>
      {list.data?.length === 0 && <Card><Empty>No announcements.</Empty></Card>}
      {list.data?.map((a) => (
        <Card key={a.id} title={a.title} actions={<><Badge>{a.audience === 'all' ? 'everyone' : a.audience}</Badge>{a.class_name && <Badge tone="warn">{a.class_name}</Badge>}</>}>
          <p className="pre">{a.body}</p>
          <p className="muted">{a.author || 'School'} · {new Date(a.created_at).toLocaleString()}</p>
          {(role === 'admin' || a.mine) && <button className="btn danger small" onClick={async () => { if (window.confirm('Delete this announcement?')) { if (await del.run(() => api.del(`/api/announcements/${a.id}`), '')) list.reload() } }}>Delete</button>}
        </Card>
      ))}
    </>
  )
}
