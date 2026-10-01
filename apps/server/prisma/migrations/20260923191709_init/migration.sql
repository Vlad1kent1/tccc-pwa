-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "EvacPriority" AS ENUM ('URGENT', 'PRIORITY', 'ROUTINE');

-- CreateEnum
CREATE TYPE "MechanismOfInjury" AS ENUM ('ARTILLERY', 'BLUNT', 'BURN', 'FALL', 'GRENADE', 'GSW', 'IED', 'LANDMINE', 'MVC', 'RPG', 'OTHER');

-- CreateEnum
CREATE TYPE "Limb" AS ENUM ('RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG');

-- CreateEnum
CREATE TYPE "BodyRegion" AS ENUM ('HEAD', 'FACE', 'NECK', 'CHEST', 'ABDOMEN', 'PELVIS', 'UPPER_BACK', 'LOWER_BACK', 'RIGHT_ARM', 'LEFT_ARM', 'RIGHT_LEG', 'LEFT_LEG');

-- CreateEnum
CREATE TYPE "BodyView" AS ENUM ('FRONT', 'BACK');

-- CreateEnum
CREATE TYPE "Avpu" AS ENUM ('ALERT', 'VERBAL', 'PAIN', 'UNRESPONSIVE');

-- CreateEnum
CREATE TYPE "CirculationTreatment" AS ENUM ('TOURNIQUET', 'DRESSING', 'HEMOSTATIC', 'PRESSURE');

-- CreateEnum
CREATE TYPE "AirwayTreatment" AS ENUM ('INTACT', 'NPA', 'CRIC', 'ET_TUBE', 'SGA');

-- CreateEnum
CREATE TYPE "BreathingTreatment" AS ENUM ('O2', 'NEEDLE_D', 'CHEST_TUBE', 'CHEST_SEAL');

-- CreateEnum
CREATE TYPE "OtherTreatment" AS ENUM ('EYE_SHIELD', 'SPLINT', 'HYPOTHERMIA_PREVENTION');

-- CreateEnum
CREATE TYPE "FluidKind" AS ENUM ('FLUID', 'BLOOD_PRODUCT');

-- CreateEnum
CREATE TYPE "MedicationCategory" AS ENUM ('ANALGESIC', 'ANTIBIOTIC', 'OTHER');

-- CreateEnum
CREATE TYPE "Route" AS ENUM ('IV', 'IO', 'IM', 'IN', 'PO', 'SC', 'PR', 'TOPICAL', 'OTHER');

-- CreateTable
CREATE TABLE "CasualtyCard" (
    "id" UUID NOT NULL,
    "lastName" TEXT,
    "firstName" TEXT,
    "gender" "Gender",
    "injuredAt" TIMESTAMPTZ(3),
    "battleRosterNumber" TEXT,
    "evacPriority" "EvacPriority",
    "allergies" TEXT,
    "mechanisms" "MechanismOfInjury"[],
    "mechanismOther" TEXT,
    "circulation" "CirculationTreatment"[],
    "airway" "AirwayTreatment"[],
    "breathing" "BreathingTreatment"[],
    "otherTreatments" "OtherTreatment"[],
    "notes" TEXT,
    "responderName" TEXT,
    "responderLast4" CHAR(4),
    "fieldClock" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "changeSeq" BIGINT NOT NULL,
    "createdByDeviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serverUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CasualtyCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InjurySite" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "region" "BodyRegion" NOT NULL,
    "view" "BodyView" NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "description" TEXT,
    "clientUpdatedAt" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "InjurySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tourniquet" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "limb" "Limb" NOT NULL,
    "type" TEXT NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL,
    "clientUpdatedAt" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Tourniquet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSigns" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "pulseRate" INTEGER,
    "pulseLocation" TEXT,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "respiratoryRate" INTEGER,
    "spo2" INTEGER,
    "avpu" "Avpu",
    "painScale" INTEGER,
    "clientUpdatedAt" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "VitalSigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FluidAdministration" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "kind" "FluidKind" NOT NULL,
    "name" TEXT NOT NULL,
    "volumeMl" INTEGER NOT NULL,
    "route" "Route" NOT NULL,
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "clientUpdatedAt" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "FluidAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "category" "MedicationCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL,
    "route" "Route" NOT NULL,
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "clientUpdatedAt" TEXT NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "label" TEXT,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedMutation" (
    "mutationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB NOT NULL,

    CONSTRAINT "ProcessedMutation_pkey" PRIMARY KEY ("mutationId")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" UUID NOT NULL,
    "cardId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "keptValue" JSONB NOT NULL,
    "discardedValue" JSONB NOT NULL,
    "discardedDeviceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedBy" TEXT,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CasualtyCard_changeSeq_key" ON "CasualtyCard"("changeSeq");

-- CreateIndex
CREATE INDEX "CasualtyCard_evacPriority_idx" ON "CasualtyCard"("evacPriority");

-- CreateIndex
CREATE INDEX "CasualtyCard_battleRosterNumber_idx" ON "CasualtyCard"("battleRosterNumber");

-- CreateIndex
CREATE INDEX "CasualtyCard_lastName_firstName_idx" ON "CasualtyCard"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "InjurySite_cardId_idx" ON "InjurySite"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "Tourniquet_cardId_limb_key" ON "Tourniquet"("cardId", "limb");

-- CreateIndex
CREATE INDEX "VitalSigns_cardId_measuredAt_idx" ON "VitalSigns"("cardId", "measuredAt");

-- CreateIndex
CREATE INDEX "FluidAdministration_cardId_idx" ON "FluidAdministration"("cardId");

-- CreateIndex
CREATE INDEX "Medication_cardId_idx" ON "Medication"("cardId");

-- CreateIndex
CREATE INDEX "ProcessedMutation_deviceId_idx" ON "ProcessedMutation"("deviceId");

-- CreateIndex
CREATE INDEX "SyncConflict_cardId_idx" ON "SyncConflict"("cardId");

-- CreateIndex
CREATE INDEX "SyncConflict_resolvedAt_idx" ON "SyncConflict"("resolvedAt");

-- AddForeignKey
ALTER TABLE "InjurySite" ADD CONSTRAINT "InjurySite_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tourniquet" ADD CONSTRAINT "Tourniquet_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSigns" ADD CONSTRAINT "VitalSigns_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FluidAdministration" ADD CONSTRAINT "FluidAdministration_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CasualtyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
