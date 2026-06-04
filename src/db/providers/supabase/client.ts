import { createClient, SupabaseClient } from '@supabase/supabase-js'
import WS from 'ws'
import { getEnv } from '../../../config/index.js'

let _client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    const env = getEnv()
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      realtime: {
        transport: WS as any,
      },
    })
  }
  return _client
}
