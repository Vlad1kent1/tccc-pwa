-- AlterTable
ALTER TABLE "FluidAdministration" ALTER COLUMN "volumeMl" DROP NOT NULL,
ALTER COLUMN "route" DROP NOT NULL,
ALTER COLUMN "administeredAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Medication" ALTER COLUMN "route" DROP NOT NULL,
ALTER COLUMN "administeredAt" DROP NOT NULL;
