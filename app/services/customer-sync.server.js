/**
 * Customer Sync Service
 * Handles bidirectional customer sync between Shopify and ERP
 */

import { db } from "../db.server.js";
import {
  upsertErpCustomer,
} from "./erp.server.js";
import {
  getCustomer,
  updateShopifyCustomer,
} from "./shopify-customers.server.js";

// ─── Shopify → ERP (Customer) ───────────────────────────────────────────────

/**
 * Sync a single Shopify customer to ERP
 * Called from webhooks (customers/create, customers/update)
 */
export async function syncCustomerShopifyToErp({
  shop,
  shopifyCustomerId,
  customerData,
  existingMapping = null,
  source = "webhook",
}) {
  const mapping = existingMapping || await db.customerMapping.findFirst({
    where: { shop, shopifyCustomerId, syncEnabled: true },
  });

  if (!mapping) {
    await logCustomerSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SKIPPED",
      source,
      shopifyCustomerId,
      errorMessage: `No mapping found for customer ${shopifyCustomerId}`,
    });
    return { skipped: true, reason: "no_mapping" };
  }

  let erpCode = mapping.erpCustomerCode || null;

  try {
    // Build address from Shopify default address
    const addr = customerData.defaultAddress || customerData.default_address;
    const addressStr = addr
      ? [addr.address1, addr.address2, addr.city, addr.province, addr.country]
          .filter(Boolean)
          .join(", ")
      : null;

    // Sync basic customer data
    const erpPayload = {
      firstName: customerData.firstName || customerData.first_name,
      lastName: customerData.lastName || customerData.last_name,
      email: customerData.email,
      phone: customerData.phone,
      address: addressStr,
      postalCode: addr?.zip || null,
      companyName: addr?.company || null,
    };

    // Read catalog values from the DB mapping (stored in CustomerMapping table)
    if (mapping.erpCustomerCode) {
      erpCode = mapping.erpCustomerCode;
      erpPayload.code = mapping.erpCustomerCode;
    }

    if (mapping.tipoDocumentoId) erpPayload.tipoDocumentoId = parseInt(mapping.tipoDocumentoId, 10);
    if (mapping.tipoPersonaId) erpPayload.tipoPersonaId = parseInt(mapping.tipoPersonaId, 10);
    if (mapping.customerTypeId) erpPayload.customerTypeId = parseInt(mapping.customerTypeId, 10);
    if (mapping.actividadEconomicaId) erpPayload.actividadEconomicaId = parseInt(mapping.actividadEconomicaId, 10);
    if (mapping.taxpayerTypeId) erpPayload.taxpayerTypeId = parseInt(mapping.taxpayerTypeId, 10);
    if (mapping.departamentoId) erpPayload.departamentoId = parseInt(mapping.departamentoId, 10);
    if (mapping.municipioId) erpPayload.municipioId = parseInt(mapping.municipioId, 10);
    if (mapping.distritoId) erpPayload.distritoId = parseInt(mapping.distritoId, 10);
    if (mapping.companyNrc) erpPayload.nrc = mapping.companyNrc;
    if (mapping.companyNumber) erpPayload.companyNumber = mapping.companyNumber;
    if (mapping.isTaxpayer != null) erpPayload.isTaxpayer = mapping.isTaxpayer;
    if (mapping.isForeigner != null) erpPayload.isForeigner = mapping.isForeigner;

    if (!erpCode) {
      console.warn(`[CustomerSync] No DUI found for customer ${mapping.shopifyCustomerId}. Set custom.customer_dui metafield or erpCustomerCode in mapping.`);
      return { skipped: true, reason: "no_dui" };
    }

    console.log(`[CustomerSync] Resolved erpCode=${erpCode}, PUT /api/shopify/customers/${erpCode}`);
    await upsertErpCustomer(shop, erpCode, erpPayload);

    // Update mapping with the resolved erpCode (in case metafield changed it)
    await db.customerMapping.update({
      where: { id: mapping.id },
      data: {
        erpCustomerCode: erpCode,
        firstName: erpPayload.firstName,
        lastName: erpPayload.lastName,
        email: erpPayload.email,
        phone: erpPayload.phone,
        lastSyncAt: new Date(),
      },
    });

    await logCustomerSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "SUCCESS",
      source,
      shopifyCustomerId,
      erpCustomerCode: erpCode,
    });

    return { success: true, erpCode };
  } catch (error) {
    await logCustomerSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "FAILED",
      source,
      shopifyCustomerId,
      erpCustomerCode: erpCode || mapping.erpCustomerCode,
      errorMessage: error.message,
    });
    throw error;
  }
}

// ─── ERP → Shopify (Customer) ───────────────────────────────────────────────

/**
 * Sync a single ERP customer to Shopify
 * Called from ERP push endpoint or cron
 */
export async function syncCustomerErpToShopify({
  shop,
  erpCustomerCode,
  customerData,
  graphql,
  source = "erp-push",
}) {
  const mappings = await db.customerMapping.findMany({
    where: { shop, erpCustomerCode, syncEnabled: true },
  });

  if (!mappings.length) {
    await logCustomerSync({
      shop,
      direction: "ERP_TO_SHOPIFY",
      status: "SKIPPED",
      source,
      erpCustomerCode,
      errorMessage: `No mapping found for ERP customer: ${erpCustomerCode}`,
    });
    return { skipped: true, reason: "no_mapping" };
  }

  const results = [];

  for (const mapping of mappings) {
    try {
      // Update basic customer info in Shopify
      const updateData = {};
      if (customerData.firstName) updateData.firstName = customerData.firstName;
      if (customerData.lastName) updateData.lastName = customerData.lastName;
      if (customerData.email) updateData.email = customerData.email;
      if (customerData.phone) updateData.phone = customerData.phone;

      if (Object.keys(updateData).length > 0) {
        await updateShopifyCustomer(graphql, mapping.shopifyCustomerId, updateData);
      }

      // Update mapping
      await db.customerMapping.update({
        where: { id: mapping.id },
        data: {
          firstName: customerData.firstName || mapping.firstName,
          lastName: customerData.lastName || mapping.lastName,
          email: customerData.email || mapping.email,
          phone: customerData.phone || mapping.phone,
          lastSyncAt: new Date(),
        },
      });

      await logCustomerSync({
        shop,
        direction: "ERP_TO_SHOPIFY",
        status: "SUCCESS",
        source,
        shopifyCustomerId: mapping.shopifyCustomerId,
        erpCustomerCode,
      });

      results.push({ success: true, shopifyCustomerId: mapping.shopifyCustomerId });
    } catch (error) {
      await logCustomerSync({
        shop,
        direction: "ERP_TO_SHOPIFY",
        status: "FAILED",
        source,
        shopifyCustomerId: mapping.shopifyCustomerId,
        erpCustomerCode,
        errorMessage: error.message,
      });
      results.push({ success: false, error: error.message });
    }
  }

  return { results };
}

// ─── Full Sync (Shopify → ERP for all mapped customers) ─────────────────────

/**
 * Read all mapped customers from Shopify and push them to the ERP.
 * This is the primary sync direction: Shopify is the source of truth.
 */
export async function fullSyncCustomersShopifyToErp({ shop, graphql, source = "manual" }) {
  const mappings = await db.customerMapping.findMany({
    where: { shop, syncEnabled: true },
  });

  console.log(`[FullSync] Found ${mappings.length} mappings for shop=${shop}. Codes:`, mappings.map(m => `${m.shopifyCustomerId} → ${m.erpCustomerCode}`));

  const results = { success: 0, failed: 0, skipped: 0, details: [] };

  for (const mapping of mappings) {
    try {
      // Fetch full customer data from Shopify (including metafields)
      const customer = await getCustomer(graphql, mapping.shopifyCustomerId);
      if (!customer) {
        const reason = `Shopify customer not found: ${mapping.shopifyCustomerId}`;
        console.warn(`[FullSync] SKIP: ${reason}`);
        results.details.push({ id: mapping.shopifyCustomerId, status: "skipped", reason });
        results.skipped++;
        continue;
      }

      // Use syncCustomerShopifyToErp, passing the mapping to avoid redundant DB lookup
      const result = await syncCustomerShopifyToErp({
        shop,
        shopifyCustomerId: mapping.shopifyCustomerId,
        customerData: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          defaultAddress: customer.defaultAddress,
        },
        existingMapping: mapping,
        source,
      });

      if (result.skipped) {
        results.details.push({ id: mapping.shopifyCustomerId, status: "skipped", reason: result.reason });
        results.skipped++;
      } else {
        results.details.push({ id: mapping.shopifyCustomerId, status: "success", erpCode: result.erpCode });
        results.success++;
      }
    } catch (error) {
      console.error(`[FullSync] FAILED for ${mapping.shopifyCustomerId} (erpCode=${mapping.erpCustomerCode}):`, error.message);
      results.details.push({ id: mapping.shopifyCustomerId, status: "failed", error: error.message });
      results.failed++;
    }
  }

  return results;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

export async function getCustomerSyncStats(shop) {
  const [totalMappings, enabledMappings, totalCustomerLogs, successLogs, failedLogs, customFieldMappings] = await Promise.all([
    db.customerMapping.count({ where: { shop } }),
    db.customerMapping.count({ where: { shop, syncEnabled: true } }),
    db.syncLog.count({ where: { shop, erpSku: { startsWith: "CUSTOMER:" } } }),
    db.syncLog.count({ where: { shop, erpSku: { startsWith: "CUSTOMER:" }, status: "SUCCESS" } }),
    db.syncLog.count({ where: { shop, erpSku: { startsWith: "CUSTOMER:" }, status: "FAILED" } }),
    db.customFieldMapping.count({ where: { shop } }),
  ]);

  return {
    totalMappings,
    enabledMappings,
    totalCustomerLogs,
    successLogs,
    failedLogs,
    customFieldMappings,
  };
}

// ─── Logging ────────────────────────────────────────────────────────────────

async function logCustomerSync({
  shop,
  direction,
  status,
  source,
  shopifyCustomerId,
  erpCustomerCode,
  errorMessage,
}) {
  try {
    await db.syncLog.create({
      data: {
        shop,
        direction,
        status,
        source,
        erpSku: erpCustomerCode ? `CUSTOMER:${erpCustomerCode}` : null,
        shopifyVariantId: shopifyCustomerId || null,
        errorMessage,
        payload: { type: "customer", shopifyCustomerId, erpCustomerCode },
      },
    });
  } catch (err) {
    console.error("Failed to write customer sync log:", err);
  }
}
