/**
 * Sync Orchestration Service
 * Handles bidirectional sync between Shopify and ERP
 */

import { db } from "../db.server.js";
import {
  getErpInventory,
  updateErpInventory,
  getAllErpInventory,
  createErpSale,
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

// ─── Shopify Order → ERP Sale ──────────────────────────────────────────────────

/**
 * Called when a Shopify order is created (via webhook)
 * Creates a sale in the ERP with the order data
 *
 * @param {object} params
 * @param {string} params.shop - Shop domain
 * @param {object} params.order - Shopify order payload from webhook
 * @param {string} params.source - Source identifier
 */
export async function syncOrderToErp({ shop, order, source = "webhook" }) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) {
    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SKIPPED",
      source,
      erpSku: `ORDER:${order.id}`,
      errorMessage: "No ERP settings configured for this shop",
    });
    return { skipped: true, reason: "no_settings" };
  }

  // Map Shopify payment gateway to ERP payment method ID
  const mapPaymentMethod = (gateway) => {
    const g = (gateway || "").toLowerCase();
    if (g.includes("cash") || g === "manual") return 1; // Efectivo
    if (g.includes("debit")) return 2; // Débito
    if (g.includes("credit") || g.includes("card") || g.includes("shopify_payments") || g.includes("stripe")) return 3; // Crédito
    if (g.includes("transfer") || g.includes("bank")) return 5; // Transferencia
    if (g.includes("paypal") || g.includes("digital")) return 8; // Dinero electrónico
    if (g.includes("bitcoin") || g.includes("crypto")) return 11; // Bitcoin
    return 99; // Otros
  };

  // Build line items from order line_items (only those with SKU)
  const lineItems = (order.line_items || [])
    .filter((item) => item.sku && item.sku.trim() !== "")
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      price: parseFloat(item.price),
      discountPercent: item.total_discount > 0
        ? Math.round((parseFloat(item.total_discount) / (parseFloat(item.price) * item.quantity)) * 100 * 100) / 100
        : 0,
    }));

  if (lineItems.length === 0) {
    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SKIPPED",
      source,
      erpSku: `ORDER:${order.id}`,
      errorMessage: "No line items with SKU found in the order",
    });
    return { skipped: true, reason: "no_skus" };
  }

  // Build billing address string
  const billing = order.billing_address || {};
  const billingAddress = [billing.address1, billing.address2, billing.city, billing.province, billing.country]
    .filter(Boolean)
    .join(", ");

  // Build shipping address string
  const shipping = order.shipping_address || {};
  const shippingAddress = [shipping.address1, shipping.address2, shipping.city, shipping.province, shipping.country]
    .filter(Boolean)
    .join(", ");

  // Build payments from Shopify transactions or use total
  const payments = [];
  if (order.payment_gateway_names && order.payment_gateway_names.length > 0) {
    // Distribute total across gateways (Shopify doesn't give per-gateway amounts in webhook)
    const perGateway = parseFloat(order.total_price) / order.payment_gateway_names.length;
    for (const gateway of order.payment_gateway_names) {
      payments.push({
        paymentMethodId: mapPaymentMethod(gateway),
        amount: Math.round(perGateway * 100) / 100,
        referenceNumber: order.checkout_token || order.name,
      });
    }
  } else {
    payments.push({
      paymentMethodId: 99,
      amount: parseFloat(order.total_price),
      referenceNumber: order.checkout_token || order.name,
    });
  }

  // Resolve customer code from note attributes or use email
  const customerCode = order.note_attributes?.find((a) => a.name === "customer_code" || a.name === "dui" || a.name === "nit")?.value || null;

  const orderData = {
    shopifyOrderId: String(order.id),
    shopifyOrderNumber: order.name || `#${order.order_number}`,
    customerEmail: order.email || order.customer?.email,
    customerCode,
    companyBranchId: parseInt(settings.erpBranchId, 10),
    invoiceTypeId: 1, // Consumidor Final (default for Shopify sales)
    paymentTermId: 1, // Contado
    catMhActividadesId: parseInt(settings.erpCompanyId, 10), // Will need configuration
    billingAddress: billingAddress || null,
    shippingAddress: shippingAddress || null,
    notes: order.note || null,
    lineItems,
    payments,
  };

  try {
    const result = await createErpSale(shop, orderData);

    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SUCCESS",
      source,
      erpSku: `ORDER:${order.id}`,
      payload: JSON.stringify({
        shopifyOrderNumber: orderData.shopifyOrderNumber,
        erpSaleId: result.saleId,
        correlativeNumber: result.correlativeNumber,
        total: result.total,
        skippedItems: result.skippedItems,
      }),
    });

    return { success: true, saleId: result.saleId, result };
  } catch (error) {
    await logSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "FAILED",
      source,
      erpSku: `ORDER:${order.id}`,
      errorMessage: error.message,
      payload: JSON.stringify({
        shopifyOrderNumber: orderData.shopifyOrderNumber,
        lineItemCount: lineItems.length,
      }),
    });

    // Queue for retry
    await queueSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      erpSku: `ORDER:${order.id}`,
      payload: { orderId: order.id, orderData },
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
