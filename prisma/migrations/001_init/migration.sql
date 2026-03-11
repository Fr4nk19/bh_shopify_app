-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('SHOPIFY_TO_ERP', 'ERP_TO_SHOPIFY');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "erpBaseUrl" TEXT NOT NULL,
    "erpApiKey" TEXT NOT NULL,
    "erpApiHeader" TEXT NOT NULL DEFAULT 'X-Api-Key',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalMin" INTEGER NOT NULL DEFAULT 15,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "shopifyInventoryItemId" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "erpSku" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "erpSku" TEXT,
    "shopifyVariantId" TEXT,
    "quantityBefore" INTEGER,
    "quantityAfter" INTEGER,
    "errorMessage" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncQueue" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "erpSku" TEXT,
    "shopifyVariantId" TEXT,
    "shopifyLocationId" TEXT,
    "quantity" INTEGER,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "status" "QueueStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shop_shopifyVariantId_shopifyLocationId_key"
  ON "ProductMapping"("shop", "shopifyVariantId", "shopifyLocationId");

CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");
CREATE INDEX "ProductMapping_shop_erpSku_idx" ON "ProductMapping"("shop", "erpSku");
CREATE INDEX "SyncLog_shop_idx" ON "SyncLog"("shop");
CREATE INDEX "SyncLog_shop_createdAt_idx" ON "SyncLog"("shop", "createdAt");
CREATE INDEX "SyncLog_status_idx" ON "SyncLog"("status");
CREATE INDEX "SyncQueue_shop_status_idx" ON "SyncQueue"("shop", "status");
CREATE INDEX "SyncQueue_status_scheduledAt_idx" ON "SyncQueue"("status", "scheduledAt");
