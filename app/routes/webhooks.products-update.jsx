/**
 * Webhook: products/update
 *
 * Triggered when a product is updated in Shopify.
 * Updates product title and variant info in our mapping table.
 */

import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";

export const action = async ({ request }) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} - shop: ${shop} - product: ${payload.id}`);

  try {
    const variants = payload.variants || [];
    for (const variant of variants) {
      await db.productMapping.updateMany({
        where: {
          shop,
          shopifyVariantId: `gid://shopify/ProductVariant/${variant.id}`,
        },
        data: {
          productTitle: payload.title,
          variantTitle: variant.title !== "Default Title" ? variant.title : null,
        },
      });
    }
  } catch (err) {
    console.error(`[Webhook] Error processing products/update:`, err);
  }

  return new Response(null, { status: 200 });
};
