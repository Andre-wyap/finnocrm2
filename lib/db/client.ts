import postgres from 'postgres'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

// Main app connection — uses app_user role; RLS is always enforced.
// ssl: true enforces sslmode=require for the VPS connection.
const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  types: {
    // Return `date` columns (OID 1082, e.g. leads.date_of_birth) as raw
    // 'YYYY-MM-DD' strings instead of JS Date objects. A Date serializes to a
    // full ISO timestamp, which <input type="date"> rejects (renders blank) and
    // which can shift the day across the UTC boundary. timestamptz columns
    // (created_at, assigned_at, ...) are a different OID and stay untouched.
    date: {
      to: 1082,
      from: [1082],
      serialize: (v: string) => v,
      parse: (v: string) => v,
    },
  },
})

export default sql
