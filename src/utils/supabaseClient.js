import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Create supabase client or mock based on configuration
export const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase environment variables not found. Please create a .env.local file with:')
    console.warn('VITE_SUPABASE_URL=your_supabase_project_url')
    console.warn('VITE_SUPABASE_ANON_KEY=your_supabase_anon_key')
    
    // Return mock client for development
    return {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        signUp: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        signOut: () => Promise.resolve({ error: null })
      },
      storage: {
        from: () => ({
          upload: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
          getPublicUrl: () => ({ data: { publicUrl: '' } }),
          remove: () => Promise.resolve({ error: new Error('Supabase not configured') })
        })
      },
      from: () => ({
        insert: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        select: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') }),
        delete: () => Promise.resolve({ error: new Error('Supabase not configured') })
      }),
      functions: {
        invoke: () => Promise.resolve({ data: null, error: new Error('Supabase not configured') })
      }
    }
  } else {
    // Return real Supabase client
    return createClient(supabaseUrl, supabaseAnonKey)
  }
})()
