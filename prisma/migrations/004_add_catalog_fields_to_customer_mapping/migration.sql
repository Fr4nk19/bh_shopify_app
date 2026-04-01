-- AlterTable
ALTER TABLE "CustomerMapping" ADD COLUMN "tipoDocumentoId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "tipoPersonaId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "customerTypeId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "actividadEconomicaId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "taxpayerTypeId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "departamentoId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "municipioId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "distritoId" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "companyNrc" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "companyNumber" TEXT;
ALTER TABLE "CustomerMapping" ADD COLUMN "isTaxpayer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerMapping" ADD COLUMN "isForeigner" BOOLEAN NOT NULL DEFAULT false;
