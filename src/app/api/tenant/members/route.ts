import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenantContext } from "@/lib/tenant-context";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/rate-limit";
import { withIdempotency } from "@/lib/idempotency";

const memberCreateSchema = z.object({
  firstName: z.string().min(2, "First name must have at least 2 characters").max(50),
  lastName: z.string().min(2, "Last name must have at least 2 characters").max(50),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "OVERDUE"]).default("ACTIVE"),
  membershipPlanId: z.string().uuid("Invalid membership plan ID").optional().nullable(),
});

export async function GET(req: NextRequest) {
  const schemaName = req.headers.get("x-tenant-schema");

  if (!schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  try {
    const members = await withTenantContext(schemaName, async (tx) => {
      return tx.$queryRawUnsafe(`
        SELECT 
          m."id", 
          m."first_name" AS "firstName", 
          m."last_name" AS "lastName", 
          m."email", 
          m."phone", 
          m."status", 
          m."membership_plan_id" AS "membershipPlanId",
          p."name" AS "planName",
          m."created_at" AS "createdAt"
        FROM "members" m
        LEFT JOIN "membership_plans" p ON m."membership_plan_id" = p."id"
        ORDER BY m."created_at" DESC;
      `);
    });

    return NextResponse.json({ success: true, data: members });
  } catch (error) {
    console.error("Error fetching members:", error);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get("x-tenant-id");
  const schemaName = req.headers.get("x-tenant-schema");

  if (!tenantId || !schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  // 1. Rate Limiting per Tenant: max 30 creations per minute
  const rateLimit = checkRateLimit({
    limit: 30,
    windowMs: 60 * 1000,
    identifier: tenantId,
    endpointName: "tenant:members:create",
  });

  if (!rateLimit.success) {
    return buildRateLimitResponse(rateLimit);
  }

  // 2. Mandatory Idempotency Layer: Guarantees no duplicate member created on retries
  return withIdempotency(req, tenantId, async () => {
    const body = await req.json();
    const parsed = memberCreateSchema.safeParse(body);

    if (!parsed.success) {
      return {
        status: 400,
        data: { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      };
    }

    const { firstName, lastName, email, phone, status, membershipPlanId } = parsed.data;

    const newMember = await withTenantContext(schemaName, async (tx) => {
      // Check if email already registered in this tenant's schema
      const existing = (await tx.$queryRawUnsafe(`
        SELECT "id" FROM "members" WHERE "email" = '${email.replace(/'/g, "''")}';
      `)) as Array<{ id: string }>;

      if (existing.length > 0) {
        throw new Error("MEMBER_EMAIL_EXISTS");
      }

      const safeFirst = firstName.replace(/'/g, "''");
      const safeLast = lastName.replace(/'/g, "''");
      const safePhone = phone ? `'${phone.replace(/'/g, "''")}'` : "NULL";
      const safePlan = membershipPlanId ? `'${membershipPlanId}'` : "NULL";

      const created = (await tx.$queryRawUnsafe(`
        INSERT INTO "members" ("first_name", "last_name", "email", "phone", "status", "membership_plan_id")
        VALUES ('${safeFirst}', '${safeLast}', '${email}', ${safePhone}, '${status}', ${safePlan})
        RETURNING "id", "first_name" AS "firstName", "last_name" AS "lastName", "email", "phone", "status", "membership_plan_id" AS "membershipPlanId", "created_at" AS "createdAt";
      `)) as Array<Record<string, unknown>>;

      return created[0];
    });

    return {
      status: 201,
      data: { success: true, message: "Member created successfully.", data: newMember },
    };
  });
}
