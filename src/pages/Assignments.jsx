import { useEffect, useState } from 'react'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Badge, Card, Empty, Field, Loading, today, useAction, useLoad } from '../components/ui'

function TeacherView() {
  const subjects = useLoad(() => api.get('/api/class-subjects'))
  const list = useLoad(() => api.get('/api/assignments'))
  const [f, setF] = useState({ class_subject_id: '', title: '', description: '', due_date: today(), max_marks: '10' })
  const [open, setOpen] = useState(null)
  const create = useAction()

  async function add(e) {
    e.preventDefault()
    if (await create.run(() => api.post('/api/assignments', { ...f, class_subject_id: Number(f.class_subject_id) }), 'Assignment posted')) {
      setF({ ...f, title: '', description: '' }); list.reload()
    }
  }
  return (
    <>
      <h1>Assignments</h1>
      <Card title="Post an assignment">
        <form className="form" onSubmit={add}>
          <Field label="Class & subject"><select required value={f.class_subject_id} onChange={(e) => setF({ ...f, class_subject_id: e.target.value })}><option value="">Select…</option>{(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.class_name} — {s.subject_name}</option>)}</select></Field>
          <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Due"><input type="date" required value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Max marks"><input type="number" min="1" required value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} style={{ width: 90 }} /></Field>
          <Field label="Instructions"><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <button className="btn" disabled={create.busy}>Post</button>
        </form>
        <Alert>{create.error}</Alert>
        <Alert kind="ok">{create.ok}</Alert>
      </Card>
      <Card title="Posted assignments">
        <Loading state={list} />
        {list.data?.length === 0 && <Empty>Nothing posted yet.</Empty>}
        {list.data?.length > 0 && (
          <table><thead><tr><th>Title</th><th>Class</th><th>Subject</th><th>Due</th><th>Submitted</th><th /></tr></thead><tbody>
            {list.data.map((a) => (
              <tr key={a.id}><td>{a.title}</td><td>{a.class_name}</td><td>{a.subject}</td><td>{a.due_date}</td><td>{a.submitted}</td>
                <td className="row"><button className="btn small" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Close' : 'Submissions'}</button>
                  <button className="btn danger small" onClick={async () => { if (window.confirm('Delete this assignment and its submissions?')) { await api.del(`/api/assignments/${a.id}`); setOpen(null); list.reload() } }}>Delete</button></td></tr>
            ))}
          </tbody></table>
        )}
      </Card>
      {open && <Submissions key={open} id={open} onSaved={list.reload} />}
    </>
  )
}

function Submissions({ id, onSaved }) {
  const state = useLoad(() => api.get(`/api/assignments/${id}/submissions`), [id])
  const [vals, setVals] = useState({})
  const act = useAction()
  useEffect(() => {
    setVals(Object.fromEntries((state.data?.submissions || []).map((s) => [s.student_id, { marks: s.marks ?? '', feedback: s.feedback ?? '' }])))
  }, [state.data])
  const grade = async (sid) => {
    if (await act.run(() => api.put(`/api/assignments/${id}/submissions/${sid}`, vals[sid]), 'Graded')) { state.reload(); onSaved() }
  }
  return (
    <Card title={`Submissions (max ${state.data?.max_marks ?? '…'} marks)`}>
      <Loading state={state} />
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{act.ok}</Alert>
      {state.data?.submissions.map((s) => (
        <div key={s.student_id} className="card">
          <div className="row"><strong>{s.name}</strong>{s.content ? <Badge tone={s.marks !== null ? 'ok' : 'warn'}>{s.marks !== null ? 'graded' : 'needs grading'}</Badge> : <Badge>not submitted</Badge>}</div>
          {s.content && (
            <>
              <p className="pre">{s.content}</p>
              <div className="form">
                <Field label="Marks"><input type="number" min="0" max={state.data.max_marks} step="0.5" style={{ width: 90 }} value={vals[s.student_id]?.marks ?? ''} onChange={(e) => setVals({ ...vals, [s.student_id]: { ...vals[s.student_id], marks: e.target.value } })} /></Field>
                <Field label="Feedback"><input value={vals[s.student_id]?.feedback ?? ''} onChange={(e) => setVals({ ...vals, [s.student_id]: { ...vals[s.student_id], feedback: e.target.value } })} /></Field>
                <button className="btn small" disabled={act.busy || vals[s.student_id]?.marks === ''} onClick={() => grade(s.student_id)}>Save grade</button>
              </div>
            </>
          )}
        </div>
      ))}
    </Card>
  )
}

function StudentView() {
  const { role, studentId } = useApp()
  const state = useLoad(() => (role === 'parent' && !studentId ? Promise.resolve([]) : api.get(withStudent('/api/assignments', studentId))), [role, studentId])
  const [text, setText] = useState({})
  const act = useAction()
  const submit = async (a) => {
    if (await act.run(() => api.post(`/api/assignments/${a.id}/submit`, { content: text[a.id] }), 'Submitted')) state.reload()
  }
  return (
    <>
      <h1>Assignments</h1>
      <Loading state={state} />
      <Alert>{act.error}</Alert>
      <Alert kind="ok">{act.ok}</Alert>
      {state.data?.length === 0 && <Card><Empty>No assignments.</Empty></Card>}
      {state.data?.map((a) => {
        const late = a.due_date < today() && !a.submission
        return (
          <Card key={a.id} title={a.title} actions={<Badge tone={a.marks !== null && a.marks !== undefined ? 'ok' : a.submission ? 'warn' : late ? 'bad' : 'gray'}>{a.marks !== null && a.marks !== undefined ? `${a.marks} / ${a.max_marks}` : a.submission ? 'submitted' : late ? 'overdue' : 'pending'}</Badge>}>
            <p className="muted">{a.subject} · due {a.due_date} · {a.max_marks} marks</p>
            {a.description && <p className="pre">{a.description}</p>}
            {a.feedback && <Alert kind="info">Teacher feedback: {a.feedback}</Alert>}
            {role === 'student' && (a.marks === null || a.marks === undefined) && (
              <>
                <textarea aria-label={`Your answer for ${a.title}`} placeholder="Type your answer…" value={text[a.id] ?? a.submission ?? ''} onChange={(e) => setText({ ...text, [a.id]: e.target.value })} />
                <p><button className="btn" disabled={act.busy || !(text[a.id] ?? '').trim()} onClick={() => submit(a)}>{a.submission ? 'Resubmit' : 'Submit'}</button></p>
              </>
            )}
            {role === 'parent' && a.submission && <p className="pre muted">Submitted: {a.submission}</p>}
          </Card>
        )
      })}
    </>
  )
}

export default function Assignments() {
  const { role } = useApp()
  return role === 'teacher' ? <TeacherView /> : <StudentView />
}
