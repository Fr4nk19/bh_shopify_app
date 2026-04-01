-- AlterTable
ALTER TABLE "CustomerMapping" ADD COLUMN "companyNrc" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "companyNumber" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "isTaxpayer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerMapping" ADD COLUMN "isForeigner" BOOLEAN NOT NULL DEFAULT false;
