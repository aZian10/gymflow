import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "gymflow_session";
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  schemaName: string;
  tenantSlug: string;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET environment variable is missing or shorter than 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Cryptographically signs a session JWT containing user and tenant identity.
 */
export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const secret = getJwtSecret();

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(secret);
}

/**
 * Verifies and decodes a session JWT. Returns null if invalid, expired, or tampered with.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });

    return {
      userId: payload.userId as string,
      email: payload.email as string,
      name: payload.name as string,
      role: payload.role as string,
      tenantId: payload.tenantId as string,
      schemaName: payload.schemaName as string,
      tenantSlug: payload.tenantSlug as string,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts and verifies the session from an incoming Next.js request (e.g. inside Route Handlers / Middleware).
 */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionPayload | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return null;
  return verifySessionToken(cookie.value);
}

/**
 * Extracts and verifies the session from Server Components / Server Actions.
 */
export async function getServerSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Returns cookie options for setting the session securely in HttpOnly storage.
 */
export function getSessionCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  };
}
