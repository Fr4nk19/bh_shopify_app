/**
 * Sync Orchestration Service
 * Handles bidirectional sync between Shopify and ERP
 */

import { db } from "../db.server.js";
import {
  getErpInventory,
  updateErpInventory,
  getAllErpInventory,
} from "./erp.server.js";
import {
  setInventoryQuantity,
  getInventoryLevel,
} from "./shopify-inventory.server.js";
import {
  syncProductCustomFieldsErpToShopify,
  syncProductCustomFieldsShopifyToErp,
} from "./customer-sync.server.js";

// ─── Shopify → ERP ─────────────────────────────────────────────────────────────

/**
 * Called when Shopify inventory changes (via webhook)
 * Pushes the new quantity to the ERP
 */
export async function syncShopifyToErp({
  shop,
  inventoryItemId,
  locationId,
  available,
  source = "webhook",
}) {
  // Find the mapping for this inventory item
  const mapping = await db.productMapping.findFirst({
    where: {
      shop,
      shopifyInventoryItemId: inventoryItemId,
      shopifyLocationId: locationId,
      syncEnabled: true,
    },
  });

  if (!mapping) {
    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SKIPPED",
      source,
      shopifyVariantId: null,
      erpSku: null,
      errorMessage: `No mapping found for inventoryItemId=${inventoryItemId} locationId=${locationId}`,
    });
    return { skipped: true, reason: "no_mapping" };
  }

  try {
    await updateErpInventory(shop, mapping.erpSku, available, {
      shopifyVariantId: mapping.shopifyVariantId,
      shopifyLocationId: locationId,
    });

    // Sync product custom fields (metafields → ERP) if graphql is available
    syncProductCustomFieldsShopifyToErp({
      shop,
      shopifyProductId: mapping.shopifyProductId,
      erpSku: mapping.erpSku,
      graphql: null, // No graphql in webhook context, will skip
    }).catch(() => {});

    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SUCCESS",
      source,
      shopifyVariantId: mapping.shopifyVariantId,
      erpSku: mapping.erpSku,
      quantityAfter: available,
    });

    return { success: true, sku: mapping.erpSku, quantity: available };
  } catch (error) {
    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "FAILED",
      source,
      shopifyVariantId: mapping.shopifyVariantId,
      erpSku: mapping.erpSku,
      quantityAfter: available,
      errorMessage: error.message,
    });

    // Queue for retry
    await queueSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      erpSku: mapping.erpSku,
      shopifyVariantId: mapping.shopifyVariantId,
      shopifyLocationId: locationId,
      quantity: available,
      payload: { inventoryItemId, locationId, available },
    });

    throw error;
  }
}

// ─── ERP → Shopify ─────────────────────────────────────────────────────────────

/**
 * Called when the ERP pushes a stock change (via /api/erp-webhook endpoint)
 * or during cron full-sync
 * Requires graphql client from Shopify session
 */
export async function syncErpToShopify({
  shop,
  erpSku,
  quantity,
  graphql,
  source = "erp-push",
}) {
  const mappings = await db.productMapping.findMany({
    where: { shop, erpSku, syncEnabled: true },
  });

  if (!mappings.length) {
    await logSync({
      shop,
      direction: "ERP_TO_SHOPIFY",
      status: "SKIPPED",
      source,
      erpSku,
      errorMessage: `No mapping found for SKU: ${erpSku}`,
    });
    return { skipped: true, reason: "no_mapping" };
  }

  const results = [];

  for (const mapping of mappings) {
    try {
      // Get current quantity before update
      const currentLevel = await getInventoryLevel(
        graphql,
        mapping.shopifyInventoryItemId,
        mapping.shopifyLocationId
      );
      const quantityBefore = currentLevel?.available ?? null;

      await setInventoryQuantity(
        graphql,
        mapping.shopifyInventoryItemId,
        mapping.shopifyLocationId,
        quantity,
        "correction"
      );

      // Sync product custom fields (ERP → metafields)
      syncProductCustomFieldsErpToShopify({
        shop,
        shopifyProductId: mapping.shopifyProductId,
        erpSku,
        graphql,
      }).catch(() => {});

      await logSync({
        shop,
        direction: "ERP_TO_SHOPIFY",
        status: "SUCCESS",
        source,
        erpSku,
        shopifyVariantId: mapping.shopifyVariantId,
        quantityBefore,
        quantityAfter: quantity,
      });

      results.push({ success: true, variantId: mapping.shopifyVariantId });
    } catch (error) {
      await logSync({
        shop,
        direction: "ERP_TO_SHOPIFY",
        status: "FAILED",
        source,
        erpSku,
        shopifyVariantId: mapping.shopifyVariantId,
        quantityAfter: quantity,
        errorMessage: error.message,
      });

      await queueSync({
        shop,
        direction: "ERP_TO_SHOPIFY",
        erpSku,
        shopifyVariantId: mapping.shopifyVariantId,
        shopifyLocationId: mapping.shopifyLocationId,
        quantity,
        payload: { erpSku, quantity },
      });

      results.push({ success: false, error: error.message });
    }
  }

  return { results };
}

// ─── Full Sync (ERP → Shopify for all mapped products) ──────────────────────

/**
 * Pull all inventory from ERP and update Shopify for all mapped products
 * Used by cron job or manual "Sync All" button
 */
export async function fullSyncErpToShopify({ shop, graphql, source = "cron" }) {
  const erpInventory = await getAllErpInventory(shop);
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const item of erpInventory) {
    const { sku, quantity } = item;
    try {
      const result = await syncErpToShopify({
        shop,
        erpSku: sku,
        quantity,
        graphql,
        source,
      });
      if (result.skipped) results.skipped++;
      else results.success++;
    } catch {
      results.failed++;
    }
  }

  // Update lastSyncAt
  await db.shopSettings.update({
    where: { shop },
    data: { lastSyncAt: new Date() },
  });

  return results;
}

// ─── Queue & Retry ──────────────────────────────────────────────────────────

export async function queueSync(data) {
  return db.syncQueue.create({ data });
}

export async function processPendingQueue({ shop, graphql }) {
  const pending = await db.syncQueue.findMany({
    where: {
      shop,
      status: "PENDING",
      attempts: { lt: db.syncQueue.fields?.maxAttempts ?? 3 },
      scheduledAt: { lte: new Date() },
    },
    take: 20,
    orderBy: { createdAt: "asc" },
  });

  for (const item of pending) {
    await db.syncQueue.update({
      where: { id: item.id },
      data: { status: "PROCESSING", attempts: { increment: 1 } },
    });

    try {
      if (item.direction === "ERP_TO_SHOPIFY") {
        await syncErpToShopify({
          shop,
          erpSku: item.erpSku,
          quantity: item.quantity,
          graphql,
          source: "retry",
        });
      } else {
        await syncShopifyToErp({
          shop,
          inventoryItemId: item.payload?.inventoryItemId,
          locationId: item.shopifyLocationId,
          available: item.quantity,
          source: "retry",
        });
      }

      await db.syncQueue.update({
        where: { id: item.id },
        data: { status: "COMPLETED", processedAt: new Date() },
      });
    } catch (error) {
      const isFinal = item.attempts + 1 >= item.maxAttempts;
      await db.syncQueue.update({
        where: { id: item.id },
        data: {
          status: isFinal ? "FAILED" : "PENDING",
          errorMessage: error.message,
          scheduledAt: new Date(Date.now() + Math.pow(2, item.attempts) * 60000),
        },
      });
    }
  }
}

// ─── Logging ────────────────────────────────────────────────────────────────

async function logSync({
  shop,
  direction,
  status,
  source,
  erpSku,
  shopifyVariantId,
  quantityBefore,
  quantityAfter,
  errorMessage,
  payload,
}) {
  try {
    await db.syncLog.create({
      data: {
        shop,
        direction,
        status,
        source,
        erpSku,
        shopifyVariantId,
        quantityBefore,
        quantityAfter,
        errorMessage,
        payload,
      },
    });
  } catch (err) {
    console.error("Failed to write sync log:", err);
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getSyncStats(shop) {
  const [total, success, failed, pending] = await Promise.all([
    db.syncLog.count({ where: { shop } }),
    db.syncLog.count({ where: { shop, status: "SUCCESS" } }),
    db.syncLog.count({ where: { shop, status: "FAILED" } }),
    db.syncQueue.count({ where: { shop, status: { in: ["PENDING", "PROCESSING"] } } }),
  ]);

  const settings = await db.shopSettings.findUnique({ where: { shop } });

  return {
    total,
    success,
    failed,
    pending,
    lastSyncAt: settings?.lastSyncAt ?? null,
    syncEnabled: settings?.syncEnabled ?? false,
  };
}
