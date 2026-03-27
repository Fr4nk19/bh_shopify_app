/**
 * Customer Sync Service
 * Handles bidirectional customer sync between Shopify and ERP,
 * including custom fields (metafields)
 */

import { db } from "../db.server.js";
import {
  getAllErpCustomers,
  getErpCustomer,
  upsertErpCustomer,
  getErpCustomerCustomFields,
  updateErpCustomerCustomFields,
  getErpProductCustomFields,
  updateErpProductCustomFields,
} from "./erp.server.js";
import {
  getCustomer,
  getAllCustomers,
  updateShopifyCustomer,
  setMetafields,
  getProductMetafields,
  erpFieldsToShopifyMetafields,
  shopifyMetafieldsToErpFields,
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

    // Determine the code to use: prefer metafield custom.customer_dui, fallback to mapping
    let erpCode = mapping.erpCustomerCode || null;

    console.log(`[CustomerSync] Shopify customer=${mapping.shopifyCustomerId}, mapping.erpCustomerCode=${mapping.erpCustomerCode}, metafields count=${customerData.metafields?.length ?? 0}`);
    if (customerData.metafields?.length) {
      console.log(`[CustomerSync] Metafields:`, customerData.metafields.map(m => `${m.namespace}.${m.key}=${m.value}`).join(', '));
    }

    // Extract ERP-specific fields from metafields (if available)
    if (customerData.metafields && Array.isArray(customerData.metafields)) {
      const mf = (ns, key) => {
        const found = customerData.metafields.find(
          (m) => m.namespace === ns && m.key === key
        );
        return found?.value ?? null;
      };

      const customerDui = mf("custom", "customer_dui");
      if (customerDui) {
        erpCode = customerDui;
        erpPayload.code = customerDui;
      }

      const tipoDocId = mf("custom", "tipo_documento_id");
      if (tipoDocId) erpPayload.tipoDocumentoId = parseInt(tipoDocId, 10);

      const tipoPersonaId = mf("custom", "tipo_persona_id");
      if (tipoPersonaId) erpPayload.tipoPersonaId = parseInt(tipoPersonaId, 10);

      const isTaxpayer = mf("custom", "is_taxpayer");
      if (isTaxpayer != null) erpPayload.isTaxpayer = isTaxpayer === "true";

      const nrc = mf("custom", "company_nrc");
      if (nrc) erpPayload.nrc = nrc;

      const companyNumber = mf("custom", "company_number");
      if (companyNumber) erpPayload.companyNumber = companyNumber;

      const isForeigner = mf("custom", "is_foreigner");
      if (isForeigner != null) erpPayload.isForeigner = isForeigner === "true";
    }

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

      // Sync custom fields (ERP custom fields → metafields)
      await syncCustomerCustomFieldsToShopify({
        shop,
        shopifyCustomerId: mapping.shopifyCustomerId,
        erpCode: erpCustomerCode,
        graphql,
      });

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

  const results = { success: 0, failed: 0, skipped: 0 };

  for (const mapping of mappings) {
    try {
      // Fetch full customer data from Shopify (including metafields)
      const customer = await getCustomer(graphql, mapping.shopifyCustomerId);
      if (!customer) {
        await logCustomerSync({
          shop,
          direction: "SHOPIFY_TO_ERP",
          status: "SKIPPED",
          source,
          shopifyCustomerId: mapping.shopifyCustomerId,
          erpCustomerCode: mapping.erpCustomerCode,
          errorMessage: `Shopify customer not found: ${mapping.shopifyCustomerId}`,
        });
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
          metafields: customer.metafields,
        },
        existingMapping: mapping,
        source,
      });

      if (result.skipped) results.skipped++;
      else results.success++;
    } catch (error) {
      console.error(`[FullSync] FAILED for ${mapping.shopifyCustomerId} (erpCode=${mapping.erpCustomerCode}):`, error.message);
      results.failed++;
    }
  }

  return results;
}

// ─── Custom Field Sync ──────────────────────────────────────────────────────

/**
 * Sync customer metafields from Shopify to ERP custom fields
 */
async function syncCustomerCustomFieldsToErp({ shop, shopifyCustomerId, erpCode, graphql }) {
  if (!graphql) return; // Can't read metafields without graphql client

  const fieldMappings = await db.customFieldMapping.findMany({
    where: {
      shop,
      resourceType: "CUSTOMER",
      syncDirection: "SHOPIFY_TO_ERP",
      syncEnabled: true,
    },
  });

  if (fieldMappings.length === 0) return;

  try {
    const customer = await getCustomer(graphql, shopifyCustomerId);
    if (!customer) return;

    const erpFields = shopifyMetafieldsToErpFields(customer.metafields, fieldMappings);

    if (Object.keys(erpFields).length > 0) {
      await updateErpCustomerCustomFields(shop, erpCode, erpFields);
    }
  } catch (error) {
    console.error(`[CustomerSync] Failed to sync custom fields to ERP for ${erpCode}:`, error.message);
  }
}

/**
 * Sync customer custom fields from ERP to Shopify metafields
 */
async function syncCustomerCustomFieldsToShopify({ shop, shopifyCustomerId, erpCode, graphql }) {
  const fieldMappings = await db.customFieldMapping.findMany({
    where: {
      shop,
      resourceType: "CUSTOMER",
      syncDirection: "ERP_TO_SHOPIFY",
      syncEnabled: true,
    },
  });

  if (fieldMappings.length === 0) return;

  try {
    const erpFields = await getErpCustomerCustomFields(shop, erpCode);
    const metafields = erpFieldsToShopifyMetafields(erpFields, fieldMappings);

    if (metafields.length > 0) {
      await setMetafields(graphql, shopifyCustomerId, metafields);
    }
  } catch (error) {
    console.error(`[CustomerSync] Failed to sync custom fields to Shopify for ${shopifyCustomerId}:`, error.message);
  }
}

/**
 * Sync product metafields from ERP to Shopify
 */
export async function syncProductCustomFieldsErpToShopify({ shop, shopifyProductId, erpSku, graphql }) {
  const fieldMappings = await db.customFieldMapping.findMany({
    where: {
      shop,
      resourceType: "PRODUCT",
      syncDirection: "ERP_TO_SHOPIFY",
      syncEnabled: true,
    },
  });

  if (fieldMappings.length === 0) return;

  try {
    const erpFields = await getErpProductCustomFields(shop, erpSku);
    const metafields = erpFieldsToShopifyMetafields(erpFields, fieldMappings);

    if (metafields.length > 0) {
      await setMetafields(graphql, shopifyProductId, metafields);
    }
  } catch (error) {
    console.error(`[CustomerSync] Failed to sync product custom fields to Shopify for ${erpSku}:`, error.message);
  }
}

/**
 * Sync product metafields from Shopify to ERP
 */
export async function syncProductCustomFieldsShopifyToErp({ shop, shopifyProductId, erpSku, graphql }) {
  const fieldMappings = await db.customFieldMapping.findMany({
    where: {
      shop,
      resourceType: "PRODUCT",
      syncDirection: "SHOPIFY_TO_ERP",
      syncEnabled: true,
    },
  });

  if (fieldMappings.length === 0) return;

  try {
    const metafields = await getProductMetafields(graphql, shopifyProductId);
    const erpFields = shopifyMetafieldsToErpFields(metafields, fieldMappings);

    if (Object.keys(erpFields).length > 0) {
      await updateErpProductCustomFields(shop, erpSku, erpFields);
    }
  } catch (error) {
    console.error(`[CustomerSync] Failed to sync product custom fields to ERP for ${erpSku}:`, error.message);
  }
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
