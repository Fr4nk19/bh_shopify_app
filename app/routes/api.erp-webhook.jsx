/**
 * ERP → Shopify Push Endpoint
 *
 * The C# ERP calls this endpoint when inventory changes on the ERP side.
 *
 * POST /api/erp-webhook
 * Headers:
 *   X-Webhook-Secret: <WEBHOOK_SECRET from .env>
 *   X-Shop-Domain: <shop>.myshopify.com
 * Body:
 * {
 *   "sku": "PROD-001",
 *   "quantity": 50,
 *   "updatedAt": "2024-01-01T00:00:00Z"
 * }
 *
 * OR batch:
 * {
 *   "items": [
 *     { "sku": "PROD-001", "quantity": 50 },
 *     { "sku": "PROD-002", "quantity": 10 }
 *   ]
 * }
 */

import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server.js";
import { syncErpToShopify } from "../services/sync.server.js";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Validate webhook secret
  const secret = request.headers.get("X-Webhook-Secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    console.warn("[ERP Webhook] Unauthorized request - invalid secret");
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get shop from header
  const shop = request.headers.get("X-Shop-Domain");
  if (!shop) {
    return json(
      { error: "Missing X-Shop-Domain header" },
      { status: 400 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Get unauthenticated graphql client for this shop
  let graphql;
  try {
    const result = await unauthenticated.admin(shop);
    graphql = result.admin.graphql;
  } catch (err) {
    console.error(`[ERP Webhook] Cannot get admin session for shop ${shop}:`, err);
    return json(
      { error: "App not installed in this shop or session expired" },
      { status: 403 }
    );
  }

  // Process single item or batch
  const items = body.items || [{ sku: body.sku, quantity: body.quantity }];
  const results = [];

  for (const item of items) {
    if (!item.sku || item.quantity === undefined) {
      results.push({ sku: item.sku, error: "Missing sku or quantity" });
      continue;
    }

    try {
      const result = await syncErpToShopify({
        shop,
        erpSku: item.sku,
        quantity: item.quantity,
        graphql,
        source: "erp-push",
      });
      results.push({ sku: item.sku, ...result });
    } catch (err) {
      console.error(`[ERP Webhook] Failed to sync SKU ${item.sku}:`, err.message);
      results.push({ sku: item.sku, error: err.message });
    }
  }

  const hasErrors = results.some((r) => r.error);
  return json(
    { results, status: hasErrors ? "partial" : "ok" },
    { status: hasErrors ? 207 : 200 }
  );
};
