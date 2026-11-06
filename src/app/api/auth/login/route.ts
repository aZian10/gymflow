import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getSessionCookieOptions, signSessionToken } from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    // Look up user and associated tenant in public schema
    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Verify password hash
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Ensure tenant is active
    if (!user.tenant || user.tenant.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Your gym account is currently inactive or suspended. Please contact support." },
        { status: 403 }
      );
    }

    // Generate authenticated session JWT
    const token = await signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant.id,
      schemaName: user.tenant.schemaName,
      tenantSlug: user.tenant.slug,
    });

    const response = NextResponse.json({
      success: true,
      message: "Authentication successful.",
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        schemaName: user.tenant.schemaName,
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });

    const cookieOptions = getSessionCookieOptions();
    response.cookies.set(cookieOptions.name, token, cookieOptions);

    return response;
  } catch (error: unknown) {
    console.error("Error during authentication:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during login." },
      { status: 500 }
    );
  }
}
