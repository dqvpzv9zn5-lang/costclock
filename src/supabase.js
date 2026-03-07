import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// Helper: check if Supabase is configured
export const isSupabaseConfigured = () => !!supabase

// Auth helpers
export async function signUp(email, password, metadata) {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadata }
  })
  if (!error && data.user) {
    // Also insert into users table
    await supabase.from('users').upsert({
      id: data.user.id,
      email,
      name: metadata.name,
      company: metadata.company,
      industry: metadata.industry,
      firm_size: metadata.firm_size,
    })
  }
  return { data, error }
}

export async function signInWithMagicLink(email) {
  if (!supabase) return { error: { message: 'Supabase not configured' } }
  return supabase.auth.signInWithOtp({ email })
}

export async function getSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getUser() {
  if (!supabase) return null
  const { data } = await supabase.auth.getUser()
  return data.user
}

export async function signOut() {
  if (!supabase) return
  await supabase.auth.signOut()
}

// Process CRUD
export async function saveProcess(userId, processData) {
  if (!supabase) return null
  const { id, ...rest } = processData

  if (id) {
    // Update existing
    const { data, error } = await supabase
      .from('processes')
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
    return { data, error }
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('processes')
      .insert({ user_id: userId, ...rest, updated_at: new Date().toISOString() })
      .select()
    return { data, error }
  }
}

export async function loadProcesses(userId) {
  if (!supabase) return []
  const { data } = await supabase
    .from('processes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  return data || []
}

export async function deleteProcess(processId) {
  if (!supabase) return
  await supabase.from('processes').delete().eq('id', processId)
}

// Event tracking
export async function trackEvent(userId, eventType, metadata = {}) {
  if (!supabase) return
  await supabase.from('events').insert({
    user_id: userId,
    event_type: eventType,
    metadata,
  })
}
