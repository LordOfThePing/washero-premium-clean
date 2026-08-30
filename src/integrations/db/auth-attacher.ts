import { createMiddleware } from '@tanstack/react-start'
import { db } from './client'

// Must be registered as a global `functionMiddleware` in `src/start.ts`; otherwise
// the browser never attaches the bearer token to serverFn RPCs.
export const attachDbAuth = createMiddleware({ type: 'function' }).client(
  async ({ next }) => {
    const { data } = await db.auth.getSession()
    const token = data.session?.access_token
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  },
)
