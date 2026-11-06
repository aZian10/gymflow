import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Validates and sanitizes PostgreSQL schema names.
 * Schema names must start with an alphabetic character or underscore,
 * followed by alphanumeric characters or underscores.
 */
export function sanitizeSchemaName(schemaName: string): string {
  const sanitized = schemaName.trim().toLowerCase();
  if (!/^[a-z_][a-z0-9_]{1,62}$/.test(sanitized)) {
    throw new Error(`Invalid schema name: "${schemaName}". Must be 2-63 chars matching [a-z0-9_].`);
  }
  return sanitized;
}

/**
 * Executes a callback within a tenant-isolated PostgreSQL transaction.
 *
 * ARCHITECTURAL GUARANTEE:
 * Uses `SET LOCAL search_path` within a PostgreSQL transaction block.
 * When the transaction completes (commit or rollback), PostgreSQL automatically
 * discards the localized search path. This prevents cross-tenant connection pool
 * contamination even under heavy connection pooling (PgBouncer / AWS RDS Proxy).
 */
export async function withTenantContext<T>(
  schemaName: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const safeSchema = sanitizeSchemaName(schemaName);

  return prisma.$transaction(async (tx) => {
    // Isolate search path strictly to the tenant's schema, falling back to public for shared utilities
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public;`);
    return callback(tx);
  });
}
