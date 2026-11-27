import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../api'
import { useSession } from './auth-client'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

/** Loads /api/me for the signed-in user and tracks which child a parent is viewing. */
export function AppProvider({ children }) {
  const { data: session, isPending } = useSession()
  const [me, setMe] = useState(null)
  const [meError, setMeError] = useState('')
  const [studentId, setStudentId] = useState(null)
  const userId = session?.user?.id

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setMe(null)
      setStudentId(null)
      return
    }
    api
      .get('/api/me')
      .then((data) => {
        if (cancelled) return
        setMe(data)
        setMeError('')
        setStudentId((cur) => cur ?? data.students[0]?.id ?? null)
      })
      .catch((err) => !cancelled && setMeError(err.message))
    return () => {
      cancelled = true
    }
  }, [userId])

  const value = { me, user: me?.user, role: me?.user?.role, students: me?.students ?? [], studentId, setStudentId, loading: isPending || (userId && !me && !meError), meError, signedIn: Boolean(userId) }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
