import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient() // same-origin, no baseURL needed
export const { useSession, signIn, signOut } = authClient
