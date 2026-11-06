import { NextRequest, NextResponse } from "next/server";
import { prisma } from "./prisma";

export const IDEMPOTENCY_HEADER = "idempotency-key";
const DEFAULT_TTL_HOURS = 24;

export interface IdempotencyResult<T> {
  isCached: boolean;
  statusCode: number;
  data: T;
}

/**
 * Handles idempotency for state-mutating requests (POST/PUT).
 *
 * ARCHITECTURAL CONTRACT:
 * 1. Checks if the `Idempotency-Key` header exists in `public.idempotency_keys`.
 * 2. If present and COMPLETED: Returns the previously stored response (no duplicate execution).
 * 3. If present and PROCESSING: Returns HTTP 409 Conflict (concurrent request in flight).
 * 4. If absent: Creates a reservation entry, executes the handler, saves the response, and sets a 24-hour TTL.
 */
export async function withIdempotency(
  req: NextRequest,
  tenantId: string | null,
  handler: () => Promise<{ status: number; data: unknown }>
): Promise<NextResponse> {
  const idempotencyKey = req.headers.get(IDEMPOTENCY_HEADER)?.trim();

  // If no idempotency key is supplied, execute normally
  if (!idempotencyKey) {
    const result = await handler();
    return NextResponse.json(result.data, { status: result.status });
  }

  const endpoint = req.nextUrl.pathname;
  const now = new Date();

  // 1. Look up existing idempotency record in public schema
  const existingRecord = await prisma.idempotencyKey.findUnique({
    where: { key: idempotencyKey },
  });

  if (existingRecord) {
    // If the key has expired, clean it up and allow re-execution
    if (existingRecord.expiresAt < now) {
      await prisma.idempotencyKey.delete({ where: { key: idempotencyKey } });
    } else if (existingRecord.status === "PROCESSING") {
      return NextResponse.json(
        {
          error: "A request with this Idempotency-Key is currently in progress. Please wait.",
        },
        { status: 409 }
      );
    } else if (existingRecord.status === "COMPLETED" && existingRecord.responseBody) {
      const cachedData = JSON.parse(existingRecord.responseBody);
      const res = NextResponse.json(cachedData, {
        status: existingRecord.statusCode ?? 200,
      });
      res.headers.set("X-Idempotent-Replay", "true");
      return res;
    }
  }

  // 2. Reserve the key in PROCESSING state
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);

  try {
    await prisma.idempotencyKey.create({
      data: {
        key: idempotencyKey,
        tenantId,
        endpoint,
        status: "PROCESSING",
        expiresAt,
      },
    });
  } catch {
    // Handle race condition where two requests hit create simultaneously
    return NextResponse.json(
      { error: "Concurrent request conflict with this Idempotency-Key." },
      { status: 409 }
    );
  }

  // 3. Execute handler and save result
  try {
    const result = await handler();

    await prisma.idempotencyKey.update({
      where: { key: idempotencyKey },
      data: {
        status: "COMPLETED",
        statusCode: result.status,
        responseBody: JSON.stringify(result.data),
      },
    });

    const response = NextResponse.json(result.data, { status: result.status });
    response.headers.set("X-Idempotent-Replay", "false");
    return response;
  } catch (error) {
    // If business logic fails, mark as FAILED so client can retry with same or new key
    await prisma.idempotencyKey.update({
      where: { key: idempotencyKey },
      data: { status: "FAILED" },
    }).catch(() => {});

    throw error;
  }
}
