import { prisma } from "../src/lib/prisma";
import { provisionTenantSchema } from "../src/lib/tenant-provisioning";
import { withTenantContext } from "../src/lib/tenant-context";
import bcrypt from "bcryptjs";

async function main() {
  console.log("=== STARTING MULTITENANT ISOLATION VERIFICATION ===");

  const testTenants = [
    {
      name: "Spartan Fitness",
      slug: "spartan-fitness",
      schemaName: "gym_spartan_fitness",
      adminEmail: "admin@spartanfitness.com",
      memberName: "Leonidas",
      memberLastName: "Spartan",
      memberEmail: "leonidas@spartan.com",
      planName: "Spartan Warrior Pass",
      planPrice: 49.99,
    },
    {
      name: "Titan Gym",
      slug: "titan-gym",
      schemaName: "gym_titan_gym",
      adminEmail: "admin@titangym.com",
      memberName: "Atlas",
      memberLastName: "Titan",
      memberEmail: "atlas@titan.com",
      planName: "Titan Olympian Pass",
      planPrice: 79.99,
    },
  ];

  for (const tenantData of testTenants) {
    console.log(`\n--- Provisioning Tenant: ${tenantData.name} (${tenantData.schemaName}) ---`);

    // 1. Check if already exists in public schema, or clean up for idempotent test run
    const existing = await prisma.tenant.findUnique({
      where: { slug: tenantData.slug },
    });

    if (existing) {
      console.log(`Tenant ${tenantData.slug} already registered.`);
    } else {
      const passwordHash = await bcrypt.hash("SpartanSecret123!", 10);

      await prisma.$transaction(async (tx) => {
        // Step A: Provision DDL schema & tables
        await provisionTenantSchema(tx, tenantData.schemaName);

        // Step B: Create Tenant record in public.tenants
        const tenant = await tx.tenant.create({
          data: {
            name: tenantData.name,
            slug: tenantData.slug,
            schemaName: tenantData.schemaName,
            status: "ACTIVE",
          },
        });

        // Step C: Create Admin User in public.users
        await tx.user.create({
          data: {
            name: `${tenantData.name} Admin`,
            email: tenantData.adminEmail,
            passwordHash,
            role: "TENANT_ADMIN",
            tenantId: tenant.id,
          },
        });
      });
      console.log(`✓ Created schema ${tenantData.schemaName} and registered tenant.`);
    }

    // 2. Populate isolated data inside the tenant's schema using withTenantContext
    await withTenantContext(tenantData.schemaName, async (tx) => {
      // Create Plan
      const plans = (await tx.$queryRawUnsafe(`
        INSERT INTO "membership_plans" ("name", "price", "duration_days", "active")
        VALUES ('${tenantData.planName}', ${tenantData.planPrice}, 30, true)
        RETURNING "id";
      `)) as { id: string }[];

      const planId = plans[0]?.id;

      // Create Member
      await tx.$executeRawUnsafe(`
        INSERT INTO "members" ("first_name", "last_name", "email", "status", "membership_plan_id")
        VALUES ('${tenantData.memberName}', '${tenantData.memberLastName}', '${tenantData.memberEmail}', 'ACTIVE', '${planId}');
      `);

      console.log(`✓ Inserted isolated Member "${tenantData.memberName}" and Plan "${tenantData.planName}" into ${tenantData.schemaName}.`);
    });
  }

  // 3. STRICT CROSS-TENANT ISOLATION PROOF
  console.log("\n=== EXECUTING ISOLATION INTEGRITY AUDIT ===");

  // Query Spartan Fitness
  const spartanMembers = await withTenantContext("gym_spartan_fitness", async (tx) => {
    return (await tx.$queryRawUnsafe(`SELECT * FROM "members";`)) as Array<{ first_name: string; email: string }>;
  });

  // Query Titan Gym
  const titanMembers = await withTenantContext("gym_titan_gym", async (tx) => {
    return (await tx.$queryRawUnsafe(`SELECT * FROM "members";`)) as Array<{ first_name: string; email: string }>;
  });

  console.log(`\nSpartan Fitness members count: ${spartanMembers.length}`);
  spartanMembers.forEach((m) => console.log(`  - Spartan Member: ${m.first_name} (${m.email})`));

  console.log(`\nTitan Gym members count: ${titanMembers.length}`);
  titanMembers.forEach((m) => console.log(`  - Titan Member: ${m.first_name} (${m.email})`));

  // Assertions
  const spartanHasTitanMember = spartanMembers.some((m) => m.email === "atlas@titan.com");
  const titanHasSpartanMember = titanMembers.some((m) => m.email === "leonidas@spartan.com");

  if (spartanHasTitanMember || titanHasSpartanMember) {
    console.error("\n❌ CRITICAL SECURITY FAILURE: CROSS-TENANT DATA LEAKAGE DETECTED!");
    process.exit(1);
  } else {
    console.log("\n✅ ISOLATION VERIFIED: ZERO CROSS-TENANT DATA LEAKAGE.");
    console.log("Each tenant's database queries are strictly confined to their own schema boundary.");
  }
}

main()
  .catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
