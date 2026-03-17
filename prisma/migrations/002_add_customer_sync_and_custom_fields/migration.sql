-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('PRODUCT', 'CUSTOMER');

-- CreateTable
CREATE TABLE "CustomerMapping" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "erpCustomerCode" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldMapping" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "resourceType" "ResourceType" NOT NULL,
    "shopifyField" TEXT NOT NULL,
    "erpField" TEXT NOT NULL,
    "syncDirection" "SyncDirection" NOT NULL DEFAULT 'ERP_TO_SHOPIFY',
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerMapping_shop_idx" ON "CustomerMapping"("shop");
CREATE INDEX "CustomerMapping_shop_erpCustomerCode_idx" ON "CustomerMapping"("shop", "erpCustomerCode");
CREATE UNIQUE INDEX "CustomerMapping_shop_shopifyCustomerId_key" ON "CustomerMapping"("shop", "shopifyCustomerId");

-- CreateIndex
CREATE INDEX "CustomFieldMapping_shop_resourceType_idx" ON "CustomFieldMapping"("shop", "resourceType");
CREATE UNIQUE INDEX "CustomFieldMapping_shop_resourceType_shopifyField_key" ON "CustomFieldMapping"("shop", "resourceType", "shopifyField");
