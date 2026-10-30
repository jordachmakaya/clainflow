-- CreateEnum
CREATE TYPE "Role" AS ENUM ('POLICYHOLDER', 'HANDLER', 'EXPERT', 'ADMIN');

-- CreateEnum
CREATE TYPE "PolicyProduct" AS ENUM ('HOME', 'MOTOR');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('WATER_DAMAGE', 'FIRE', 'THEFT', 'GLASS_BREAKAGE', 'VEHICLE_COLLISION');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DECLARED', 'UNDER_REVIEW', 'EXPERTISE', 'ACCEPTED', 'REJECTED', 'SETTLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ClaimEventType" AS ENUM ('DECLARED', 'STATUS_CHANGED', 'EXPERT_REPORT_SUBMITTED', 'DOCUMENT_ADDED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "product" "PolicyProduct" NOT NULL,
    "holder_id" UUID NOT NULL,
    "coverage_start" DATE NOT NULL,
    "coverage_end" DATE NOT NULL,
    "deductible" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "declarant_id" UUID NOT NULL,
    "type" "ClaimType" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "discovered_on" DATE NOT NULL,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "estimated_amount" INTEGER NOT NULL,
    "late_declaration" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DECLARED',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handler_id" UUID,
    "expert_id" UUID,
    "expert_report_at" TIMESTAMP(3),
    "assessed_amount" INTEGER,
    "approved_amount" INTEGER,
    "settled_amount" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" "ClaimEventType" NOT NULL,
    "from_status" "ClaimStatus",
    "to_status" "ClaimStatus",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_documents" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "policies_number_key" ON "policies"("number");

-- CreateIndex
CREATE INDEX "policies_holder_id_idx" ON "policies"("holder_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_reference_key" ON "claims"("reference");

-- CreateIndex
CREATE INDEX "claims_declarant_id_idx" ON "claims"("declarant_id");

-- CreateIndex
CREATE INDEX "claims_handler_id_idx" ON "claims"("handler_id");

-- CreateIndex
CREATE INDEX "claims_expert_id_idx" ON "claims"("expert_id");

-- CreateIndex
CREATE INDEX "claims_status_status_changed_at_idx" ON "claims"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "claim_events_claim_id_created_at_idx" ON "claim_events"("claim_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "claim_documents_storage_key_key" ON "claim_documents"("storage_key");

-- CreateIndex
CREATE INDEX "claim_documents_claim_id_idx" ON "claim_documents"("claim_id");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_holder_id_fkey" FOREIGN KEY ("holder_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_declarant_id_fkey" FOREIGN KEY ("declarant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_handler_id_fkey" FOREIGN KEY ("handler_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_expert_id_fkey" FOREIGN KEY ("expert_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
