import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withTenantContext } from "@/lib/tenant-context";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/rate-limit";

const attendanceSchema = z.object({
  memberId: z.string().uuid("Invalid member ID"),
  notes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const schemaName = req.headers.get("x-tenant-schema");

  if (!schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  try {
    const records = await withTenantContext(schemaName, async (tx) => {
      return tx.$queryRawUnsafe(`
        SELECT 
          a."id", 
          a."member_id" AS "memberId", 
          m."first_name" AS "firstName", 
          m."last_name" AS "lastName", 
          m."email", 
          a."check_in_time" AS "checkInTime", 
          a."notes"
        FROM "attendances" a
        JOIN "members" m ON a."member_id" = m."id"
        ORDER BY a."check_in_time" DESC
        LIMIT 100;
      `);
    });

    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error("Error fetching attendances:", error);
    return NextResponse.json({ error: "Failed to fetch attendance records" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get("x-tenant-id");
  const schemaName = req.headers.get("x-tenant-schema");

  if (!tenantId || !schemaName) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }

  // Rate Limiting per Tenant: max 60 check-ins per minute
  const rateLimit = checkRateLimit({
    limit: 60,
    windowMs: 60 * 1000,
    identifier: tenantId,
    endpointName: "tenant:attendance:create",
  });

  if (!rateLimit.success) {
    return buildRateLimitResponse(rateLimit);
  }

  try {
    const body = await req.json();
    const parsed = attendanceSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { memberId, notes } = parsed.data;

    const record = await withTenantContext(schemaName, async (tx) => {
      // 1. Verify member exists and is active
      const member = (await tx.$queryRawUnsafe(`
        SELECT "id", "first_name", "status" FROM "members" WHERE "id" = '${memberId}';
      `)) as Array<{ id: string; first_name: string; status: string }>;

      if (member.length === 0) {
        throw new Error("MEMBER_NOT_FOUND");
      }

      if (member[0].status !== "ACTIVE") {
        throw new Error("MEMBER_NOT_ACTIVE");
      }

      const safeNotes = notes ? `'${notes.replace(/'/g, "''")}'` : "NULL";

      const created = (await tx.$queryRawUnsafe(`
        INSERT INTO "attendances" ("member_id", "notes")
        VALUES ('${memberId}', ${safeNotes})
        RETURNING "id", "member_id" AS "memberId", "check_in_time" AS "checkInTime", "notes";
      `)) as Array<Record<string, unknown>>;

      return created[0];
    });

    return NextResponse.json(
      { success: true, message: "Attendance registered successfully.", data: record },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "MEMBER_NOT_FOUND") {
      return NextResponse.json({ error: "Member not found." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "MEMBER_NOT_ACTIVE") {
      return NextResponse.json(
        { error: "Cannot register attendance. Member status is not ACTIVE." },
        { status: 403 }
      );
    }
    console.error("Error creating attendance record:", error);
    return NextResponse.json({ error: "Failed to record attendance." }, { status: 500 });
  }
}
