import sql from './client'
import type { TransactionSql } from 'postgres'

/**
 * Run a query inside a transaction with SET LOCAL app.current_user_id.
 * This is the ONLY way to query the DB as an authenticated user — every
 * request that touches RLS-protected tables must go through this function.
 *
 * SET LOCAL is transaction-scoped, preventing identity leakage across
 * pooled connections.
 */
export async function withUser<T>(
  profileId: string,
  fn: (tx: TransactionSql) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.current_user_id', ${profileId}, true)`
    return fn(tx)
  }) as Promise<T>
}
