import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenantContext } from "@/lib/tenant-context";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/rate-limit";

const planCreateSchema = z.object({
  name: z.string().min(2, "Plan name must have at least 2 characters").max(100),
  price: z.number().positive("Price must be a positive number"),
  durationDays: z.number().int().positive("Duration must be a positive number of days"),
  description: z.string().optional(),
  active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const schemaName = req.headers.get("x-tenant-schema");

  if (!schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  try {
    const plans = await withTenantContext(schemaName, async (tx) => {
      return tx.$queryRawUnsafe(`
        SELECT "id", "name", "price", "duration_days" AS "durationDays", "description", "active", "created_at" AS "createdAt"
        FROM "membership_plans"
        ORDER BY "created_at" DESC;
      `);
    });

    return NextResponse.json({ success: true, data: plans });
  } catch (error) {
    console.error("Error fetching membership plans:", error);
    return NextResponse.json({ error: "Failed to fetch membership plans" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get("x-tenant-id");
  const schemaName = req.headers.get("x-tenant-schema");

  if (!tenantId || !schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  // Rate Limiting per Tenant: max 30 creations per minute
  const rateLimit = checkRateLimit({
    limit: 30,
    windowMs: 60 * 1000,
    identifier: tenantId,
    endpointName: "tenant:plans:create",
  });

  if (!rateLimit.success) {
    return buildRateLimitResponse(rateLimit);
  }

  try {
    const body = await req.json();
    const parsed = planCreateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, price, durationDays, description, active } = parsed.data;

    const newPlan = await withTenantContext(schemaName, async (tx) => {
      const sanitizedDesc = description ? `'${description.replace(/'/g, "''")}'` : "NULL";
      const sanitizedName = name.replace(/'/g, "''");

      const created = (await tx.$queryRawUnsafe(`
        INSERT INTO "membership_plans" ("name", "price", "duration_days", "description", "active")
        VALUES ('${sanitizedName}', ${price}, ${durationDays}, ${sanitizedDesc}, ${active})
        RETURNING "id", "name", "price", "duration_days" AS "durationDays", "description", "active", "created_at" AS "createdAt";
      `)) as Array<Record<string, unknown>>;

      return created[0];
    });

    return NextResponse.json({ success: true, data: newPlan }, { status: 201 });
  } catch (error) {
    console.error("Error creating membership plan:", error);
    return NextResponse.json({ error: "Failed to create membership plan" }, { status: 500 });
  }
}
