import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

export const requireDbAuth = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {

    const API_URL = process.env.API_URL;
    const ANON_KEY = process.env.ANON_KEY;

    if (!API_URL || !ANON_KEY) {
      const missing = [
        ...(!API_URL ? ['API_URL'] : []),
        ...(!ANON_KEY ? ['ANON_KEY'] : []),
      ];
      const message = `Missing backend environment variable(s): ${missing.join(', ')}.`;
      console.error(`[db] ${message}`);
      throw new Error(message);
    }

    const request = getRequest();

    if (!request?.headers) {
      throw new Error('Unauthorized: No request headers available');
    }

    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      throw new Error('Unauthorized: No authorization header provided');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new Error('Unauthorized: Only Bearer tokens are supported');
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      throw new Error('Unauthorized: No token provided');
    }

    const db = createClient<Database>(
      API_URL!,
      ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    );

    const { data, error } = await db.auth.getClaims(token);
    if (error || !data?.claims) {
      throw new Error('Unauthorized: Invalid token');
    }

    if (!data.claims.sub) {
      throw new Error('Unauthorized: No user ID found in token');
    }

    return next({
      context: {
        db,
        userId: data.claims.sub,
        claims: data.claims,
      },
    });
  },
);
