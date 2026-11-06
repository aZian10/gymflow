import { checkRateLimit } from "../src/lib/rate-limit";
import { withIdempotency } from "../src/lib/idempotency";
import { NextRequest } from "next/server";
import { prisma } from "../src/lib/prisma";
import { withTenantContext } from "../src/lib/tenant-context";

async function runTests() {
  console.log("=== STARTING IDEMPOTENCY & RATE LIMITING VERIFICATION ===");

  // -------------------------------------------------------------
  // TEST 1: RATE LIMITING (Sliding Window Algorithm)
  // -------------------------------------------------------------
  console.log("\n[1/2] Testing Rate Limiting on Login Endpoint (Limit = 5 / min per IP)...");
  const testIp = "192.168.1.100";
  const windowMs = 60 * 1000;
  const limit = 5;

  let blockedOnAttempt = 0;
  for (let i = 1; i <= 7; i++) {
    const result = checkRateLimit({
      limit,
      windowMs,
      identifier: testIp,
      endpointName: "test:auth:login",
    });

    if (result.success) {
      console.log(`  Request #${i}: ALLOWED (Remaining: ${result.remaining})`);
    } else {
      console.log(`  Request #${i}: BLOCKED with HTTP 429! (Retry-After: ${result.resetInSeconds}s)`);
      if (blockedOnAttempt === 0) blockedOnAttempt = i;
    }
  }

  if (blockedOnAttempt === 6) {
    console.log("✓ Rate limiting correctly blocked excess traffic at request #6 (Limit: 5).");
  } else {
    throw new Error(`Rate limiting failed. Expected block on #6, got: ${blockedOnAttempt}`);
  }

  // -------------------------------------------------------------
  // TEST 2: IDEMPOTENCY (Key Storage & Duplicate Prevention)
  // -------------------------------------------------------------
  console.log("\n[2/2] Testing Idempotency on Member Creation...");
  const idempotencyKey = `idem-key-${Date.now()}`;
  const testSchema = "gym_spartan_fitness";

  const tenant = await prisma.tenant.findUnique({ where: { slug: "spartan-fitness" } });
  if (!tenant) throw new Error("Spartan Fitness tenant not found. Please run test-multitenant-isolation first.");

  // Check how many members currently exist
  const initialMembers = (await withTenantContext(testSchema, async (tx) => {
    return (await tx.$queryRawUnsafe(`SELECT count(*)::int as count FROM "members";`)) as Array<{ count: number }>;
  }))[0].count;

  console.log(`  Initial members in ${testSchema}: ${initialMembers}`);

  // Create mock request helper
  function makeMockRequest(key: string) {
    return new NextRequest("http://localhost:3001/api/tenant/members", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        firstName: "Gorgo",
        lastName: "Queen",
        email: `queen_${Date.now()}@spartan.com`,
      }),
    });
  }

  let executionCounter = 0;
  const businessHandler = async () => {
    executionCounter++;
    // Execute database insert inside tenant schema
    await withTenantContext(testSchema, async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "members" ("first_name", "last_name", "email", "status")
        VALUES ('Gorgo', 'Queen', 'gorgo_${Date.now()}@spartan.com', 'ACTIVE');
      `);
    });
    return {
      status: 201,
      data: { success: true, member: "Gorgo Queen", execution: executionCounter },
    };
  };

  // First Request with Key
  console.log(`\n  Dispatching Request 1 with Key: ${idempotencyKey}...`);
  const req1 = makeMockRequest(idempotencyKey);
  const res1 = await withIdempotency(req1, tenant.id, businessHandler);
  const data1 = await res1.json();
  console.log(`  Request 1 Status: ${res1.status}, X-Idempotent-Replay: ${res1.headers.get("x-idempotent-replay")}`);

  // Second Request with SAME Key (Simulating Network Retry / Double Click)
  console.log(`\n  Dispatching Duplicate Request 2 with SAME Key: ${idempotencyKey}...`);
  const req2 = makeMockRequest(idempotencyKey);
  const res2 = await withIdempotency(req2, tenant.id, businessHandler);
  const data2 = await res2.json();
  console.log(`  Request 2 Status: ${res2.status}, X-Idempotent-Replay: ${res2.headers.get("x-idempotent-replay")}`);

  // Third Request with SAME Key
  console.log(`\n  Dispatching Duplicate Request 3 with SAME Key: ${idempotencyKey}...`);
  const req3 = makeMockRequest(idempotencyKey);
  const res3 = await withIdempotency(req3, tenant.id, businessHandler);
  const data3 = await res3.json();

  // Audit database record count
  const finalMembers = (await withTenantContext(testSchema, async (tx) => {
    return (await tx.$queryRawUnsafe(`SELECT count(*)::int as count FROM "members";`)) as Array<{ count: number }>;
  }))[0].count;

  console.log(`\n  Total members after 3 identical requests: ${finalMembers}`);
  console.log(`  Business logic execution counter: ${executionCounter}`);

  if (executionCounter === 1 && finalMembers === initialMembers + 1) {
    console.log("\n✅ IDEMPOTENCY VERIFIED: Only 1 member record created despite 3 duplicate requests!");
    console.log(`  Cached response returned accurately: ${JSON.stringify(data2)}`);
  } else {
    throw new Error(
      `Idempotency failed! Expected 1 execution and 1 new record. Executions: ${executionCounter}, Records added: ${finalMembers - initialMembers}`
    );
  }
}

runTests()
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
