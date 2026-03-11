/**
 * Webhook: products/create
 *
 * Triggered when a new product is created in Shopify.
 * We auto-import variants with SKUs into the mapping table (as unmapped).
 */

import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop} - product: ${payload.id}`);

  // Pre-populate ProductMapping rows for variants that have a SKU
  // They will be unmapped (no erpSku) until the merchant maps them in the UI
  try {
    const variants = payload.variants || [];
    for (const variant of variants) {
      if (!variant.sku) continue;

      // We don't have inventoryItemId/locationId from this webhook payload,
      // so we store what we have — the full mapping is completed in the UI
      await db.productMapping.upsert({
        where: {
          shop_shopifyVariantId_shopifyLocationId: {
            shop,
            shopifyVariantId: `gid://shopify/ProductVariant/${variant.id}`,
            shopifyLocationId: "PENDING",
          },
        },
        update: {
          productTitle: payload.title,
          variantTitle: variant.title !== "Default Title" ? variant.title : null,
        },
        create: {
          shop,
          shopifyProductId: `gid://shopify/Product/${payload.id}`,
          shopifyVariantId: `gid://shopify/ProductVariant/${variant.id}`,
          shopifyInventoryItemId: `gid://shopify/InventoryItem/${variant.inventory_item_id}`,
          shopifyLocationId: "PENDING",
          productTitle: payload.title,
          variantTitle: variant.title !== "Default Title" ? variant.title : null,
          erpSku: variant.sku,
          syncEnabled: false, // Disabled until merchant confirms mapping
        },
      });
    }
  } catch (err) {
    console.error(`[Webhook] Error processing products/create:`, err);
  }

  return new Response(null, { status: 200 });
};
