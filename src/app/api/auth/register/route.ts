import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { provisionTenantSchema } from "@/lib/tenant-provisioning";
import { sanitizeSchemaName } from "@/lib/tenant-context";
import { getSessionCookieOptions, signSessionToken } from "@/lib/auth";
import { checkRateLimit, buildRateLimitResponse, getClientIp } from "@/lib/rate-limit";
import { withIdempotency } from "@/lib/idempotency";

const registerSchema = z.object({
  gymName: z.string().min(2, "Gym name must have at least 2 characters").max(100),
  gymSlug: z
    .string()
    .min(3, "Slug must have at least 3 characters")
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must only contain lowercase letters, numbers, and hyphens"),
  adminName: z.string().min(2, "Admin name must have at least 2 characters").max(100),
  adminEmail: z.string().email("Invalid email address"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters long"),
});

export async function POST(req: NextRequest) {
  // 1. Rate Limiting on creation endpoint (10 requests per 60 seconds per IP)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit({
    limit: 10,
    windowMs: 60 * 1000,
    identifier: clientIp,
    endpointName: "auth:register",
  });

  if (!rateLimit.success) {
    return buildRateLimitResponse(rateLimit);
  }

  // 2. Wrap with Idempotency Engine to prevent duplicate gym creation on network retries
  return withIdempotency(req, null, async () => {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return {
        status: 400,
        data: { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      };
    }

    const { gymName, gymSlug, adminName, adminEmail, adminPassword } = parsed.data;

    // Check uniqueness of slug and email in global public schema
    const [existingSlug, existingEmail] = await Promise.all([
      prisma.tenant.findUnique({ where: { slug: gymSlug } }),
      prisma.user.findUnique({ where: { email: adminEmail } }),
    ]);

    if (existingSlug) {
      return {
        status: 409,
        data: { error: "A gym with this slug is already registered. Please choose another slug." },
      };
    }

    if (existingEmail) {
      return {
        status: 409,
        data: { error: "A user with this email address is already registered." },
      };
    }

    // Generate sanitized schema name (e.g., gym_iron_fitness)
    const rawSchemaName = `gym_${gymSlug.replace(/-/g, "_")}`;
    const schemaName = sanitizeSchemaName(rawSchemaName);

    // Hash admin password using bcrypt (work factor 12)
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // ATOMIC EXECUTION: Schema creation, Tenant creation, and User registration in a single transaction
    const { newTenant, newUser } = await prisma.$transaction(async (tx) => {
      // 1. Provision isolated schema and domain tables
      await provisionTenantSchema(tx, schemaName);

      // 2. Register Tenant in public.tenants
      const newTenant = await tx.tenant.create({
        data: {
          name: gymName,
          slug: gymSlug,
          schemaName,
          status: "ACTIVE",
        },
      });

      // 3. Register Admin User in public.users
      const newUser = await tx.user.create({
        data: {
          name: adminName,
          email: adminEmail,
          passwordHash,
          role: "TENANT_ADMIN",
          tenantId: newTenant.id,
        },
      });

      return { newTenant, newUser };
    });

    // Generate session JWT token
    const token = await signSessionToken({
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      tenantId: newTenant.id,
      schemaName: newTenant.schemaName,
      tenantSlug: newTenant.slug,
    });

    const cookieOptions = getSessionCookieOptions();

    return {
      status: 201,
      data: {
        success: true,
        message: "Gym and administrator account registered successfully.",
        tenant: {
          id: newTenant.id,
          name: newTenant.name,
          slug: newTenant.slug,
          schemaName: newTenant.schemaName,
        },
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
      },
    };
  });
}
