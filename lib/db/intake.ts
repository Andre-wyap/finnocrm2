import postgres from 'postgres'

if (!process.env.DATABASE_URL_INTAKE) {
  throw new Error('DATABASE_URL_INTAKE is not set')
}

// Intake connection — uses intake_role which bypasses RLS.
// Only used by the /api/intake endpoint.
const intakeSql = postgres(process.env.DATABASE_URL_INTAKE, {
  ssl: 'require',
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
})

export default intakeSql
