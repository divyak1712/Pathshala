import { useEffect, useState } from 'react'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Bar, Card, Empty, Field, Loading, today, useAction, useLoad } from '../components/ui'

const tone = (p) => (p >= 75 ? 'ok' : p >= 50 ? 'warn' : 'bad')

function Gradebook() {
  const subjects = useLoad(() => api.get('/api/class-subjects'))
  const [cs, setCs] = useState('')
  const assessments = useLoad(() => (cs ? api.get(`/api/grades/assessments?classSubjectId=${cs}`) : Promise.resolve([])), [cs])
  const [open, setOpen] = useState(null)
  const [f, setF] = useState({ title: '', kind: 'exam', max_marks: '100', date: today() })
  const create = useAction()

  useEffect(() => {
    if (!cs && subjects.data?.length) setCs(String(subjects.data[0].id))
  }, [subjects.data, cs])

  async function add(e) {
    e.preventDefault()
    if (await create.run(() => api.post('/api/grades/assessments', { ...f, class_subject_id: Number(cs) }), 'Assessment created')) {
      setF({ ...f, title: '' }); assessments.reload()
    }
  }

  return (
    <>
      <h1>Gradebook</h1>
      <Card>
        <Field label="Class & subject">
          <select value={cs} onChange={(e) => { setCs(e.target.value); setOpen(null) }}>
            {(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.class_name} — {s.subject_name}</option>)}
          </select>
        </Field>
        {subjects.data?.length === 0 && <Empty>You do not teach any subjects yet. Ask the administrator to assign you.</Empty>}
      </Card>
      {cs && (
        <>
          <Card title="New assessment">
            <form className="form" onSubmit={add}>
              <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Type"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['exam', 'quiz', 'test', 'project'].map((k) => <option key={k}>{k}</option>)}</select></Field>
              <Field label="Max marks"><input type="number" required min="1" step="0.5" value={f.max_marks} onChange={(e) => setF({ ...f, max_marks: e.target.value })} /></Field>
              <Field label="Date"><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
              <button className="btn" disabled={create.busy}>Create</button>
            </form>
            <Alert>{create.error}</Alert>
          </Card>
          <Card title="Assessments">
            <Loading state={assessments} />
            {assessments.data?.length === 0 && <Empty>No assessments yet.</Empty>}
            {assessments.data?.length > 0 && (
              <table><thead><tr><th>Title</th><th>Type</th><th>Date</th><th>Max</th><th>Graded</th><th /></tr></thead><tbody>
                {assessments.data.map((a) => (
                  <tr key={a.id}><td>{a.title}</td><td>{a.kind}</td><td>{a.date}</td><td>{a.max_marks}</td><td>{a.graded}</td>
                    <td className="row"><button className="btn small" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Close' : 'Enter marks'}</button>
                      <button className="btn danger small" onClick={async () => { if (window.confirm('Delete this assessment and all its marks?')) { await api.del(`/api/grades/assessments/${a.id}`); setOpen(null); assessments.reload() } }}>Delete</button></td></tr>
                ))}
              </tbody></table>
            )}
          </Card>
          {open && <MarksEntry key={open} id={open} onSaved={assessments.reload} />}
        </>
      )}
    </>
  )
}

function MarksEntry({ id, onSaved }) {
  const state = useLoad(() => api.get(`/api/grades/assessments/${id}/grades`), [id])
  const [vals, setVals] = useState({})
  const save = useAction()
  useEffect(() => {
    setVals(Object.fromEntries((state.data?.grades || []).map((g) => [g.student_id, { marks: g.marks ?? '', remarks: g.remarks ?? '' }])))
  }, [state.data])
  const set = (sid, k, v) => setVals({ ...vals, [sid]: { ...vals[sid], [k]: v } })

  async function submit() {
    const ok = await save.run(() => api.put(`/api/grades/assessments/${id}/grades`, { grades: Object.entries(vals).map(([student_id, v]) => ({ student_id: Number(student_id), ...v })) }), 'Marks saved')
    if (ok) onSaved()
  }
  return (
    <Card title={`Enter marks (out of ${state.data?.max_marks ?? '…'})`}>
      <Loading state={state} />
      {state.data && (
        <>
          <table><thead><tr><th>Roll</th><th>Student</th><th>Marks</th><th>Remarks</th></tr></thead><tbody>
            {state.data.grades.map((g) => (
              <tr key={g.student_id}><td>{g.roll_no ?? '—'}</td><td>{g.name}</td>
                <td><input aria-label={`Marks for ${g.name}`} type="number" min="0" max={state.data.max_marks} step="0.5" style={{ width: 90 }} value={vals[g.student_id]?.marks ?? ''} onChange={(e) => set(g.student_id, 'marks', e.target.value)} /></td>
                <td><input aria-label={`Remarks for ${g.name}`} value={vals[g.student_id]?.remarks ?? ''} onChange={(e) => set(g.student_id, 'remarks', e.target.value)} /></td></tr>
            ))}
          </tbody></table>
          <Alert>{save.error}</Alert>
          <Alert kind="ok">{save.ok}</Alert>
          <p><button className="btn" disabled={save.busy} onClick={submit}>Save marks</button></p>
        </>
      )}
    </Card>
  )
}

function ReportCard() {
  const { studentId, role } = useApp()
  const state = useLoad(() => (role === 'parent' && !studentId ? Promise.resolve(null) : api.get(withStudent('/api/grades/student', studentId))), [studentId, role])
  const d = state.data
  return (
    <>
      <h1>Grades</h1>
      <Loading state={state} />
      {d && (
        <>
          <Card title="Subject averages">
            {d.subjects.length === 0 ? <Empty>No grades published yet.</Empty> : (
              <table><tbody>{d.subjects.map((s) => (
                <tr key={s.subject}><td>{s.subject}</td><td style={{ width: '55%' }}><Bar value={s.percentage} tone={tone(s.percentage)} /></td><td>{s.percentage}%</td></tr>
              ))}</tbody></table>
            )}
          </Card>
          {d.grades.length > 0 && (
            <Card title="All results">
              <table><thead><tr><th>Date</th><th>Subject</th><th>Assessment</th><th>Marks</th><th>Remarks</th></tr></thead><tbody>
                {d.grades.map((g) => <tr key={g.id}><td>{g.date}</td><td>{g.subject}</td><td>{g.title} <span className="muted">({g.kind})</span></td><td>{g.marks} / {g.max_marks}</td><td>{g.remarks || '—'}</td></tr>)}
              </tbody></table>
            </Card>
          )}
        </>
      )}
    </>
  )
}

export default function Grades() {
  const { role } = useApp()
  return role === 'teacher' ? <Gradebook /> : <ReportCard />
}
