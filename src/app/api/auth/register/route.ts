import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { provisionTenantSchema } from "@/lib/tenant-provisioning";
import { sanitizeSchemaName } from "@/lib/tenant-context";
import { getSessionCookieOptions, signSessionToken } from "@/lib/auth";

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
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { gymName, gymSlug, adminName, adminEmail, adminPassword } = parsed.data;

    // Check uniqueness of slug and email in global public schema
    const [existingSlug, existingEmail] = await Promise.all([
      prisma.tenant.findUnique({ where: { slug: gymSlug } }),
      prisma.user.findUnique({ where: { email: adminEmail } }),
    ]);

    if (existingSlug) {
      return NextResponse.json(
        { error: "A gym with this slug is already registered. Please choose another slug." },
        { status: 409 }
      );
    }

    if (existingEmail) {
      return NextResponse.json(
        { error: "A user with this email address is already registered." },
        { status: 409 }
      );
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

    // Build response and set HttpOnly cookie
    const response = NextResponse.json(
      {
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
      { status: 201 }
    );

    const cookieOptions = getSessionCookieOptions();
    response.cookies.set(cookieOptions.name, token, cookieOptions);

    return response;
  } catch (error: unknown) {
    console.error("Error during tenant registration:", error);
    return NextResponse.json(
      { error: "Internal server error occurred while provisioning tenant." },
      { status: 500 }
    );
  }
}
