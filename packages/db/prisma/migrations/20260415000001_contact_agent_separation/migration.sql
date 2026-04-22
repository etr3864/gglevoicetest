-- Phase 1: Contact-Agent separation (tenant isolation)
-- Phase 2: Missing indexes on calls table

-- Step 1: Add nullable agent_id column to contacts
ALTER TABLE "contacts" ADD COLUMN "agent_id" TEXT;

-- Step 2: Populate agent_id from the most recent call per contact
-- For contacts with calls from a single agent, this is straightforward.
-- For contacts with calls from multiple agents, we pick the most recent agent
-- and will duplicate in Step 3.
UPDATE "contacts" c
SET "agent_id" = sub."agent_id"
FROM (
  SELECT DISTINCT ON ("contact_id") "contact_id", "agent_id"
  FROM "calls"
  WHERE "contact_id" IS NOT NULL
  ORDER BY "contact_id", "created_at" DESC
) sub
WHERE c."id" = sub."contact_id";

-- Step 3: Handle contacts with calls from multiple agents.
-- For each extra agent, create a new contact row and re-point calls + followups + appointments + reminders.
DO $$
DECLARE
  rec RECORD;
  new_id TEXT;
BEGIN
  FOR rec IN
    SELECT DISTINCT ca."contact_id", ca."agent_id"
    FROM "calls" ca
    JOIN "contacts" co ON co."id" = ca."contact_id"
    WHERE ca."contact_id" IS NOT NULL
      AND ca."agent_id" != co."agent_id"
  LOOP
    new_id := gen_random_uuid()::TEXT;

    INSERT INTO "contacts" ("id", "agent_id", "phone", "name", "email", "gender", "notes", "metadata", "total_calls", "total_duration_sec", "last_call_at", "created_at")
    SELECT new_id, rec."agent_id", "phone", "name", "email", "gender", "notes", "metadata", 0, 0, NULL, NOW()
    FROM "contacts" WHERE "id" = rec."contact_id";

    UPDATE "calls" SET "contact_id" = new_id
    WHERE "contact_id" = rec."contact_id" AND "agent_id" = rec."agent_id";

    UPDATE "contact_followups" SET "contact_id" = new_id
    WHERE "contact_id" = rec."contact_id" AND "agent_id" = rec."agent_id";

    UPDATE "appointments" SET "contact_id" = new_id
    WHERE "contact_id" = rec."contact_id" AND "agent_id" = rec."agent_id";

    UPDATE "scheduled_reminders" sr SET "contact_id" = new_id
    FROM "appointments" a
    WHERE sr."appointment_id" = a."id"
      AND a."contact_id" = rec."contact_id"
      AND a."agent_id" = rec."agent_id";
  END LOOP;
END;
$$;

-- Step 4: Recalculate stats for all contacts
UPDATE "contacts" c
SET
  "total_calls" = COALESCE(agg."cnt", 0),
  "total_duration_sec" = COALESCE(agg."dur", 0),
  "last_call_at" = agg."last_at"
FROM (
  SELECT "contact_id", COUNT(*) AS "cnt", COALESCE(SUM("duration_sec"), 0) AS "dur", MAX("created_at") AS "last_at"
  FROM "calls"
  WHERE "contact_id" IS NOT NULL
  GROUP BY "contact_id"
) agg
WHERE c."id" = agg."contact_id";

-- Step 5: Delete orphan contacts (no calls, no agent)
DELETE FROM "contacts" WHERE "agent_id" IS NULL;

-- Step 6: Make agent_id required
ALTER TABLE "contacts" ALTER COLUMN "agent_id" SET NOT NULL;

-- Step 7: Add foreign key
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 8: Drop old unique, add compound unique
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_phone_key";
CREATE UNIQUE INDEX "contacts_phone_agent_id_key" ON "contacts"("phone", "agent_id");

-- Step 9: Add index on agent_id for contacts
CREATE INDEX "contacts_agent_id_idx" ON "contacts"("agent_id");

-- Phase 2: Missing indexes on calls
CREATE INDEX "calls_agent_id_status_idx" ON "calls"("agent_id", "status");
CREATE INDEX "calls_contact_id_created_at_idx" ON "calls"("contact_id", "created_at");
