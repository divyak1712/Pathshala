import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useApp } from './lib/app-context'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import Users from './pages/Users'
import Academics from './pages/Academics'
import Timetable from './pages/Timetable'
import Attendance from './pages/Attendance'
import Grades from './pages/Grades'
import Assignments from './pages/Assignments'
import Fees from './pages/Fees'
import Announcements from './pages/Announcements'

function Protected({ roles, children }) {
  const { signedIn, role, loading, meError } = useApp()
  const location = useLocation()
  if (loading) return <p className="muted" style={{ padding: 24 }}>Loading…</p>
  if (!signedIn) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (meError) return <p className="alert error">{meError}</p>
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<Profile />} />
        <Route path="users" element={<Protected roles={['admin']}><Users /></Protected>} />
        <Route path="academics" element={<Protected roles={['admin']}><Academics /></Protected>} />
        <Route path="timetable" element={<Timetable />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="grades" element={<Protected roles={['teacher', 'student', 'parent']}><Grades /></Protected>} />
        <Route path="assignments" element={<Protected roles={['teacher', 'student', 'parent']}><Assignments /></Protected>} />
        <Route path="fees" element={<Protected roles={['admin', 'student', 'parent']}><Fees /></Protected>} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
