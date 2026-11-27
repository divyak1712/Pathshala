import { useState } from 'react'
import { api, withStudent } from '../api'
import { useApp } from '../lib/app-context'
import { Alert, Card, DAYS, Empty, Field, Loading, useAction, useLoad } from '../components/ui'

export default function Timetable() {
  const { role, studentId } = useApp()
  const admin = role === 'admin'
  const [classId, setClassId] = useState('')
  const classes = useLoad(() => (admin ? api.get('/api/classes') : Promise.resolve([])), [admin])
  const subjects = useLoad(() => (admin && classId ? api.get(`/api/class-subjects?classId=${classId}`) : Promise.resolve([])), [admin, classId])
  const tt = useLoad(
    () => (role === 'parent' && !studentId ? Promise.resolve([]) : api.get(admin ? `/api/timetable${classId ? `?classId=${classId}` : ''}` : withStudent('/api/timetable', studentId))),
    [admin, classId, studentId, role]
  )
  const [f, setF] = useState({ class_subject_id: '', day: '1', start_time: '09:00', end_time: '09:45', room: '' })
  const add = useAction()
  const del = useAction()

  async function submit(e) {
    e.preventDefault()
    if (await add.run(() => api.post('/api/timetable', { ...f, class_subject_id: Number(f.class_subject_id), day: Number(f.day) }), 'Period added')) tt.reload()
  }

  const byDay = {}
  ;(tt.data || []).forEach((p) => (byDay[p.day] ??= []).push(p))

  return (
    <>
      <h1>{admin ? 'Timetable' : role === 'teacher' ? 'My timetable' : 'Class timetable'}</h1>
      {admin && (
        <Card title="Add a period">
          <div className="form">
            <Field label="Class">
              <select value={classId} onChange={(e) => { setClassId(e.target.value); setF({ ...f, class_subject_id: '' }) }}>
                <option value="">All classes</option>
                {(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
              </select>
            </Field>
          </div>
          {classId ? (
            <form className="form" onSubmit={submit}>
              <Field label="Subject"><select required value={f.class_subject_id} onChange={(e) => setF({ ...f, class_subject_id: e.target.value })}><option value="">Select…</option>{(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.subject_name} ({s.teacher_name || 'no teacher'})</option>)}</select></Field>
              <Field label="Day"><select value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>
              <Field label="Start"><input type="time" required value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
              <Field label="End"><input type="time" required value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
              <Field label="Room"><input size={8} value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
              <button className="btn" disabled={add.busy}>Add period</button>
            </form>
          ) : <p className="muted">Pick a class to add periods. Subjects come from its teaching assignments.</p>}
          <Alert>{add.error}</Alert>
          <Alert kind="ok">{add.ok}</Alert>
        </Card>
      )}
      <Loading state={tt} />
      {tt.data?.length === 0 && <Card><Empty>No periods scheduled.</Empty></Card>}
      {Object.keys(byDay).sort().map((d) => (
        <Card key={d} title={DAYS[d]}>
          <table><thead><tr><th>Time</th><th>Subject</th>{role !== 'student' && role !== 'parent' && <th>Class</th>}<th>Teacher</th><th>Room</th>{admin && <th />}</tr></thead><tbody>
            {byDay[d].map((p) => (
              <tr key={p.id}><td>{p.start_time}–{p.end_time}</td><td>{p.subject}</td>
                {role !== 'student' && role !== 'parent' && <td>{p.class_name}</td>}
                <td>{p.teacher_name || '—'}</td><td>{p.room || '—'}</td>
                {admin && <td><button className="btn danger small" onClick={async () => (await del.run(() => api.del(`/api/timetable/${p.id}`), 'Removed')) && tt.reload()}>Remove</button></td>}</tr>
            ))}
          </tbody></table>
        </Card>
      ))}
      <Alert>{del.error}</Alert>
    </>
  )
}
