/*
  Warnings:

  - You are about to drop the `knowledge_bases` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `knowledge_documents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "knowledge_bases" DROP CONSTRAINT "knowledge_bases_agent_id_fkey";

-- DropForeignKey
ALTER TABLE "knowledge_documents" DROP CONSTRAINT "knowledge_documents_knowledge_base_id_fkey";

-- DropTable
DROP TABLE "knowledge_bases";

-- DropTable
DROP TABLE "knowledge_documents";