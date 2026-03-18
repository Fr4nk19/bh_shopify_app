/**
 * ERP → Shopify Customer Push Endpoint
 *
 * The C# ERP calls this endpoint when customer data changes on the ERP side.
 *
 * POST /api/erp-customer-webhook
 * Headers:
 *   X-Webhook-Secret: <WEBHOOK_SECRET from .env>
 *   X-Shop-Domain: <shop>.myshopify.com
 * Body:
 * {
 *   "code": "CLI-001",
 *   "firstName": "Juan",
 *   "lastName": "Pérez",
 *   "email": "juan@example.com",
 *   "phone": "+521234567890",
 *   "customFields": { "rfc": "XAXX010101000", "credit_limit": "50000" }
 * }
 *
 * OR batch:
 * {
 *   "items": [
 *     { "code": "CLI-001", "firstName": "Juan", ... },
 *     { "code": "CLI-002", "firstName": "María", ... }
 *   ]
 * }
 */

import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server.js";
import { syncCustomerErpToShopify } from "../services/customer-sync.server.js";

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // Validate webhook secret
  const secret = request.headers.get("X-Webhook-Secret");
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    console.warn("[ERP Customer Webhook] Unauthorized request - invalid secret");
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
    console.error(`[ERP Customer Webhook] Cannot get admin session for shop ${shop}:`, err);
    return json(
      { error: "App not installed in this shop or session expired" },
      { status: 403 }
    );
  }

  // Process single item or batch
  const items = body.items || [body];
  const results = [];

  for (const item of items) {
    if (!item.code) {
      results.push({ code: item.code, error: "Missing customer code" });
      continue;
    }

    try {
      const result = await syncCustomerErpToShopify({
        shop,
        erpCustomerCode: item.code,
        customerData: {
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          phone: item.phone,
        },
        graphql,
        source: "erp-push",
      });
      results.push({ code: item.code, ...result });
    } catch (err) {
      console.error(`[ERP Customer Webhook] Failed to sync customer ${item.code}:`, err.message);
      results.push({ code: item.code, error: err.message });
    }
  }

  const hasErrors = results.some((r) => r.error);
  return json(
    { results, status: hasErrors ? "partial" : "ok" },
    { status: hasErrors ? 207 : 200 }
  );
};
