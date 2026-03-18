-- AlterTable: add new columns to users
ALTER TABLE "users" ADD COLUMN "name" TEXT;
ALTER TABLE "users" ADD COLUMN "company_name" TEXT;
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "parent_id" TEXT;

-- AlterDefault: role default from 'admin' to 'super_admin'
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'super_admin';

-- Data migration: existing users become super_admin
UPDATE "users" SET "role" = 'super_admin' WHERE "role" = 'admin';

-- CreateIndex
CREATE INDEX "users_parent_id_idx" ON "users"("parent_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
