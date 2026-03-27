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
  source = "webhook",
}) {
  const mapping = await db.customerMapping.findFirst({
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

    // Extract ERP-specific fields from metafields (if available)
    if (customerData.metafields && Array.isArray(customerData.metafields)) {
      const mf = (ns, key) => {
        const found = customerData.metafields.find(
          (m) => m.namespace === ns && m.key === key
        );
        return found?.value ?? null;
      };

      const nitDui = mf("custom", "nit_dui");
      if (nitDui) erpPayload.code = nitDui;

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

    await upsertErpCustomer(shop, mapping.erpCustomerCode, erpPayload);

    // Sync custom fields (metafields → ERP custom fields)
    await syncCustomerCustomFieldsToErp({ shop, shopifyCustomerId, erpCode: mapping.erpCustomerCode, graphql: null });

    // Update mapping
    await db.customerMapping.update({
      where: { id: mapping.id },
      data: {
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
      erpCustomerCode: mapping.erpCustomerCode,
    });

    return { success: true, erpCode: mapping.erpCustomerCode };
  } catch (error) {
    await logCustomerSync({
      shop,
      direction: "SHOPIFY_TO_ERP",
      status: "FAILED",
      source,
      shopifyCustomerId,
      erpCustomerCode: mapping.erpCustomerCode,
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

// ─── Full Sync (ERP → Shopify for all mapped customers) ─────────────────────

/**
 * Pull all customers from ERP and update Shopify for all mapped customers
 */
export async function fullSyncCustomersErpToShopify({ shop, graphql, source = "cron" }) {
  const erpCustomers = await getAllErpCustomers(shop);
  const results = { success: 0, failed: 0, skipped: 0 };

  for (const customer of erpCustomers) {
    const { code } = customer;
    try {
      const result = await syncCustomerErpToShopify({
        shop,
        erpCustomerCode: code,
        customerData: customer,
        graphql,
        source,
      });
      if (result.skipped) results.skipped++;
      else results.success++;
    } catch {
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
