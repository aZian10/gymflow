import { NextRequest, NextResponse } from "next/server";

interface RateLimitRecord {
  timestamps: number[];
}

const memoryStore = new Map<string, RateLimitRecord>();

// Periodic garbage collection every 5 minutes to prevent memory leaks (unref'd to not hold event loop)
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
      record.timestamps = record.timestamps.filter((t) => now - t < 120000);
      if (record.timestamps.length === 0) {
        memoryStore.delete(key);
      }
    }
  }, 300000);
  if (timer.unref) {
    timer.unref();
  }
}

export interface RateLimitOptions {
  limit: number; // Max requests allowed
  windowMs: number; // Window duration in milliseconds
  identifier: string; // Tenant ID, User ID, or IP address
  endpointName: string;
}

export interface RateLimitCheckResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Evaluates rate limiting using the Sliding Window Log algorithm.
 *
 * WHY SLIDING WINDOW?
 * Unlike Fixed Window (which suffers from edge bursts where double the requests can hit
 * within 2 seconds across the window boundary), Sliding Window tracks precise timestamps,
 * providing mathematically smooth rate enforcement.
 */
export function checkRateLimit(options: RateLimitOptions): RateLimitCheckResult {
  const { limit, windowMs, identifier, endpointName } = options;
  const key = `${endpointName}:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  const record = memoryStore.get(key) ?? { timestamps: [] };

  // Retain only timestamps that fall within the active sliding window
  record.timestamps = record.timestamps.filter((timestamp) => timestamp > windowStart);

  if (record.timestamps.length >= limit) {
    const oldestTimestamp = record.timestamps[0];
    const resetInSeconds = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

    return {
      success: false,
      limit,
      remaining: 0,
      resetInSeconds,
    };
  }

  // Record this valid request
  record.timestamps.push(now);
  memoryStore.set(key, record);

  const remaining = Math.max(0, limit - record.timestamps.length);
  const resetInSeconds = Math.ceil(windowMs / 1000);

  return {
    success: true,
    limit,
    remaining,
    resetInSeconds,
  };
}

/**
 * Helper to construct a standardized HTTP 429 Too Many Requests response
 * with all mandatory RFC-compliant rate limit headers.
 */
export function buildRateLimitResponse(check: RateLimitCheckResult): NextResponse {
  return NextResponse.json(
    {
      error: "Too Many Requests",
      message: `Rate limit exceeded. Please wait ${check.resetInSeconds} seconds before retrying.`,
      retryAfter: check.resetInSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": check.resetInSeconds.toString(),
        "X-RateLimit-Limit": check.limit.toString(),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": (Math.floor(Date.now() / 1000) + check.resetInSeconds).toString(),
      },
    }
  );
}

/**
 * Extracts the real client IP from standard proxy headers (X-Forwarded-For, etc.)
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}
