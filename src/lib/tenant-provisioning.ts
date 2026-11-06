import { Prisma } from "@prisma/client";
import { sanitizeSchemaName } from "./tenant-context";

/**
 * Generates the idempotent SQL statements required to provision
 * a newly registered gym tenant's PostgreSQL schema and isolated domain tables.
 */
export function getTenantSchemaDDL(schemaName: string): string[] {
  const safe = sanitizeSchemaName(schemaName);

  return [
    // 1. Create isolated schema
    `CREATE SCHEMA IF NOT EXISTS "${safe}";`,

    // 2. Membership Plans table
    `CREATE TABLE IF NOT EXISTS "${safe}"."membership_plans" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name" TEXT NOT NULL,
      "price" DECIMAL(10, 2) NOT NULL,
      "duration_days" INTEGER NOT NULL,
      "description" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`,

    // 3. Members table
    `CREATE TABLE IF NOT EXISTS "${safe}"."members" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "first_name" TEXT NOT NULL,
      "last_name" TEXT NOT NULL,
      "email" TEXT NOT NULL,
      "phone" TEXT,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "membership_plan_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "members_membership_plan_id_fkey" FOREIGN KEY ("membership_plan_id") 
        REFERENCES "${safe}"."membership_plans"("id") ON DELETE SET NULL
    );`,

    // 4. Attendances table
    `CREATE TABLE IF NOT EXISTS "${safe}"."attendances" (
      "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "member_id" TEXT NOT NULL,
      "check_in_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "notes" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "attendances_member_id_fkey" FOREIGN KEY ("member_id") 
        REFERENCES "${safe}"."members"("id") ON DELETE CASCADE
    );`,

    // 5. Query acceleration indexes
    `CREATE INDEX IF NOT EXISTS "members_email_idx" ON "${safe}"."members"("email");`,
    `CREATE INDEX IF NOT EXISTS "attendances_member_id_idx" ON "${safe}"."attendances"("member_id");`,
    `CREATE INDEX IF NOT EXISTS "attendances_check_in_time_idx" ON "${safe}"."attendances"("check_in_time");`,
  ];
}

/**
 * Provisions a complete tenant schema within an active transaction.
 * If any table or index creation fails, the entire transaction rolls back.
 */
export async function provisionTenantSchema(
  tx: Prisma.TransactionClient,
  schemaName: string
): Promise<void> {
  const statements = getTenantSchemaDDL(schemaName);
  for (const statement of statements) {
    await tx.$executeRawUnsafe(statement);
  }
}
