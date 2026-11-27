import { useState } from 'react'
import { api } from '../api'
import { Alert, Card, Empty, Field, Loading, useAction, useLoad } from '../components/ui'

const YEAR = `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`

export default function Academics() {
  const classes = useLoad(() => api.get('/api/classes'))
  const subjects = useLoad(() => api.get('/api/subjects'))
  const teachers = useLoad(() => api.get('/api/users?role=teacher'))
  const cs = useLoad(() => api.get('/api/class-subjects'))
  const roster = useLoad(() => api.get('/api/students'))

  const [cls, setCls] = useState({ name: '', section: 'A', academic_year: YEAR, class_teacher_id: '' })
  const [sub, setSub] = useState({ name: '', code: '' })
  const [link, setLink] = useState({ class_id: '', subject_id: '', teacher_id: '' })
  const a1 = useAction(), a2 = useAction(), a3 = useAction(), a4 = useAction()

  const addClass = async (e) => {
    e.preventDefault()
    if (await a1.run(() => api.post('/api/classes', { ...cls, class_teacher_id: cls.class_teacher_id || null }), 'Class created')) {
      setCls({ ...cls, name: '' }); classes.reload()
    }
  }
  const addSubject = async (e) => {
    e.preventDefault()
    if (await a2.run(() => api.post('/api/subjects', sub), 'Subject created')) { setSub({ name: '', code: '' }); subjects.reload() }
  }
  const assign = async (e) => {
    e.preventDefault()
    if (await a3.run(() => api.put('/api/class-subjects', { class_id: Number(link.class_id), subject_id: Number(link.subject_id), teacher_id: link.teacher_id || null }), 'Assignment saved')) cs.reload()
  }
  const del = (url, state, reload, label) => async () => {
    if (!window.confirm(`Delete ${label}? Related records (attendance, grades, timetable…) are removed too.`)) return
    if (await state.run(() => api.del(url), 'Deleted')) reload()
  }
  const moveStudent = async (s, class_id) => {
    await a4.run(() => api.patch(`/api/students/${s.id}`, { ...s, class_id: class_id ? Number(class_id) : null, dob: s.dob ? s.dob.slice(0, 10) : null }), 'Student updated')
    roster.reload(); classes.reload()
  }
  const teacherOptions = (teachers.data || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)

  return (
    <>
      <h1>Classes & Subjects</h1>
      <div className="grid cols-2">
        <Card title="Classes">
          <form className="form" onSubmit={addClass}>
            <Field label="Name"><input required placeholder="Grade 5" value={cls.name} onChange={(e) => setCls({ ...cls, name: e.target.value })} /></Field>
            <Field label="Section"><input required size={4} value={cls.section} onChange={(e) => setCls({ ...cls, section: e.target.value })} /></Field>
            <Field label="Year"><input required size={8} value={cls.academic_year} onChange={(e) => setCls({ ...cls, academic_year: e.target.value })} /></Field>
            <Field label="Class teacher"><select value={cls.class_teacher_id} onChange={(e) => setCls({ ...cls, class_teacher_id: e.target.value })}><option value="">—</option>{teacherOptions}</select></Field>
            <button className="btn" disabled={a1.busy}>Add</button>
          </form>
          <Alert>{a1.error}</Alert>
          <Loading state={classes} />
          {classes.data?.length === 0 && <Empty>No classes yet.</Empty>}
          {classes.data?.length > 0 && (
            <table><thead><tr><th>Class</th><th>Year</th><th>Class teacher</th><th>Students</th><th /></tr></thead><tbody>
              {classes.data.map((c) => (
                <tr key={c.id}><td>{c.name} {c.section}</td><td>{c.academic_year}</td><td>{c.class_teacher_name || '—'}</td><td>{c.student_count}</td>
                  <td><button className="btn danger small" onClick={del(`/api/classes/${c.id}`, a1, classes.reload, `${c.name} ${c.section}`)}>Delete</button></td></tr>
              ))}
            </tbody></table>
          )}
        </Card>

        <Card title="Subjects">
          <form className="form" onSubmit={addSubject}>
            <Field label="Name"><input required value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></Field>
            <Field label="Code"><input required size={6} value={sub.code} onChange={(e) => setSub({ ...sub, code: e.target.value })} /></Field>
            <button className="btn" disabled={a2.busy}>Add</button>
          </form>
          <Alert>{a2.error}</Alert>
          <Loading state={subjects} />
          {subjects.data?.length === 0 && <Empty>No subjects yet.</Empty>}
          {subjects.data?.length > 0 && (
            <table><tbody>{subjects.data.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td className="muted">{s.code}</td>
                <td><button className="btn danger small" onClick={del(`/api/subjects/${s.id}`, a2, subjects.reload, s.name)}>Delete</button></td></tr>
            ))}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="Teaching assignments (who teaches what, where)">
        <form className="form" onSubmit={assign}>
          <Field label="Class"><select required value={link.class_id} onChange={(e) => setLink({ ...link, class_id: e.target.value })}><option value="">Select…</option>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
          <Field label="Subject"><select required value={link.subject_id} onChange={(e) => setLink({ ...link, subject_id: e.target.value })}><option value="">Select…</option>{(subjects.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Teacher"><select value={link.teacher_id} onChange={(e) => setLink({ ...link, teacher_id: e.target.value })}><option value="">Unassigned</option>{teacherOptions}</select></Field>
          <button className="btn" disabled={a3.busy}>Assign</button>
        </form>
        <Alert>{a3.error}</Alert>
        {cs.data?.length === 0 && <Empty>No assignments yet. Assigning a teacher here is what gives them access to a class.</Empty>}
        {cs.data?.length > 0 && (
          <table><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th /></tr></thead><tbody>
            {cs.data.map((r) => (
              <tr key={r.id}><td>{r.class_name}</td><td>{r.subject_name}</td><td>{r.teacher_name || <span className="muted">Unassigned</span>}</td>
                <td><button className="btn danger small" onClick={del(`/api/class-subjects/${r.id}`, a3, cs.reload, `${r.subject_name} in ${r.class_name}`)}>Remove</button></td></tr>
            ))}
          </tbody></table>
        )}
      </Card>

      <Card title="Student placement">
        <Alert>{a4.error}</Alert>
        {roster.data?.length === 0 && <Empty>No students yet. Create student accounts under Users.</Empty>}
        {roster.data?.length > 0 && (
          <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission</th><th>Class</th><th>Parents</th></tr></thead><tbody>
            {roster.data.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{s.admission_no}</td>
                <td><select aria-label={`Class for ${s.name}`} value={s.class_id ?? ''} onChange={(e) => moveStudent(s, e.target.value)}>
                  <option value="">— none —</option>{(classes.data || []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></td>
                <td>{s.parents.map((p) => p.name).join(', ') || <span className="muted">none linked</span>}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
    </>
  )
}
