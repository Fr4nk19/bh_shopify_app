/**
 * ERP Client Service
 * Handles all communication with the bh_backend REST API via /api/shopify/ endpoints
 *
 * Backend endpoints (bh_backend ShopifyController):
 *   GET    /api/shopify/health                          → health check (no auth)
 *   GET    /api/shopify/inventory?companyId=&branchId=  → list all inventory items
 *   GET    /api/shopify/inventory/{sku}?companyId=&branchId= → get inventory for a SKU
 *   PUT    /api/shopify/inventory/{sku}?companyId=&branchId= → update inventory for a SKU
 *   GET    /api/shopify/products?companyId=             → list all products
 *   GET    /api/shopify/products/{sku}?companyId=       → get product by SKU
 *   GET    /api/shopify/customers?companyId=            → list all customers
 *   GET    /api/shopify/customers/{code}?companyId=     → get customer by code
 *   PUT    /api/shopify/customers/{code}?companyId=     → upsert customer
 *
 * Authentication: X-Api-Key header (configurable per shop)
 */

import axios from "axios";
import { db } from "../db.server.js";

/**
 * Build an axios instance configured for a specific shop's ERP.
 * Returns { client, settings } where settings includes companyId/branchId.
 */
async function getErpClient(shop) {
  const settings = await db.shopSettings.findUnique({ where: { shop } });

  if (!settings) {
    throw new Error(
      `No ERP settings configured for shop: ${shop}. Please configure the ERP connection in Settings.`
    );
  }

  return {
    client: axios.create({
      baseURL: settings.erpBaseUrl,
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
        [settings.erpApiHeader]: settings.erpApiKey,
      },
    }),
    settings,
  };
}

/**
 * Build query string params for inventory endpoints (require companyId + branchId)
 */
function inventoryParams(settings) {
  const params = {};
  if (settings.erpCompanyId) params.companyId = settings.erpCompanyId;
  if (settings.erpBranchId) params.branchId = settings.erpBranchId;
  return params;
}

/**
 * Build query string params for product/customer endpoints (require companyId)
 */
function companyParams(settings) {
  const params = {};
  if (settings.erpCompanyId) params.companyId = settings.erpCompanyId;
  return params;
}

// ─── Inventory ────────────────────────────────────────────────────────────────

/**
 * Get inventory level for a specific SKU from ERP
 * @returns {{ sku, barcode, productName, quantity, availableQuantity, location, warehouseId, cost, price, unitMeasure, updatedAt }}
 */
export async function getErpInventory(shop, sku) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get(
      `/api/shopify/inventory/${encodeURIComponent(sku)}`,
      { params: inventoryParams(settings) }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("getErpInventory", sku, error);
  }
}

/**
 * Update inventory level for a SKU in the ERP
 * @param {string} shop
 * @param {string} sku
 * @param {number} quantity - New absolute quantity
 * @param {object} meta - Extra metadata (shopify variant id, etc.)
 */
export async function updateErpInventory(shop, sku, quantity, meta = {}) {
  const { client, settings } = await getErpClient(shop);

  const payload = {
    sku,
    quantity,
    source: "shopify",
    updatedAt: new Date().toISOString(),
    ...meta,
  };

  try {
    const response = await client.put(
      `/api/shopify/inventory/${encodeURIComponent(sku)}`,
      payload,
      { params: inventoryParams(settings) }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("updateErpInventory", sku, error);
  }
}

/**
 * Get all inventory items from the ERP
 * @returns {Array<{ sku, quantity, ... }>}
 */
export async function getAllErpInventory(shop) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get("/api/shopify/inventory", {
      params: inventoryParams(settings),
    });
    // Backend returns { items: [...], totalCount }
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpInventory", null, error);
  }
}

// ─── Products ─────────────────────────────────────────────────────────────────

/**
 * Get all products from the ERP
 * @returns {Array<{ sku, name, description, category, brand, price, ... }>}
 */
export async function getAllErpProducts(shop) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get("/api/shopify/products", {
      params: companyParams(settings),
    });
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpProducts", null, error);
  }
}

/**
 * Get a single product by SKU from the ERP
 * @returns {{ sku, barcode, name, description, category, brand, price, cost, unitMeasure, images, updatedAt }}
 */
export async function getErpProduct(shop, sku) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get(
      `/api/shopify/products/${encodeURIComponent(sku)}`,
      { params: companyParams(settings) }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("getErpProduct", sku, error);
  }
}

// ─── Test Connection ──────────────────────────────────────────────────────────

/**
 * Test ERP connection using the /api/shopify/health endpoint
 * @returns {{ success: boolean, message: string }}
 */
export async function testErpConnection(shop) {
  try {
    const { client, settings } = await getErpClient(shop);

    const res = await client.get("/api/shopify/health");
    const data = res.data;

    let message = "Conexión exitosa";
    if (data.shopifyIntegration === "not_configured") {
      message += " (advertencia: integración Shopify no configurada en el backend)";
    }

    // Verify API key by calling an authenticated endpoint
    if (settings.erpCompanyId && settings.erpBranchId) {
      try {
        const invRes = await client.get("/api/shopify/inventory", {
          params: inventoryParams(settings),
        });
        const items = Array.isArray(invRes.data) ? invRes.data : invRes.data.items || [];
        message += `. ${items.length} items de inventario encontrados.`;
      } catch (invError) {
        const status = invError.response?.status;
        if (status === 401 || status === 403) {
          return {
            success: false,
            message: "API Key inválida. La conexión al servidor funciona pero la autenticación falló. Verifica que la API Key sea correcta y esté activa.",
          };
        }
        message += ". No se pudo verificar el inventario (verifica Company ID y Branch ID).";
      }
    }

    return { success: true, message, data };
  } catch (error) {
    return {
      success: false,
      message: buildErpError("testErpConnection", null, error).message,
    };
  }
}

// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Get all customers from the ERP
 * @returns {Array<{ code, firstName, lastName, companyName, email, phone, address, isTaxpayer, nrc, updatedAt }>}
 */
export async function getAllErpCustomers(shop) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get("/api/shopify/customers", {
      params: companyParams(settings),
    });
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpCustomers", null, error);
  }
}

/**
 * Get a specific customer from the ERP by code (DUI/NIT)
 */
export async function getErpCustomer(shop, code) {
  const { client, settings } = await getErpClient(shop);

  try {
    const response = await client.get(
      `/api/shopify/customers/${encodeURIComponent(code)}`,
      { params: companyParams(settings) }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("getErpCustomer", code, error);
  }
}

/**
 * Create or update a customer in the ERP
 */
export async function upsertErpCustomer(shop, code, customerData) {
  const { client, settings } = await getErpClient(shop);

  const payload = {
    code,
    ...customerData,
    source: "shopify",
    updatedAt: new Date().toISOString(),
  };

  try {
    const response = await client.put(
      `/api/shopify/customers/${encodeURIComponent(code)}`,
      payload,
      { params: companyParams(settings) }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("upsertErpCustomer", code, error);
  }
}

// ─── Sales ───────────────────────────────────────────────────────────────────

/**
 * Create a sale in the ERP from a Shopify order
 * POST /api/shopify/sales?companyId=&branchId=
 *
 * @param {string} shop - Shop domain
 * @param {object} orderData - Sale data matching ShopifySaleCreateRequest
 * @param {string} orderData.shopifyOrderId - Shopify order ID
 * @param {string} orderData.shopifyOrderNumber - Display order number
 * @param {string} orderData.customerEmail - Customer email
 * @param {string} orderData.customerCode - Customer DUI/NIT (optional)
 * @param {number} orderData.companyBranchId - Branch ID
 * @param {number} orderData.invoiceTypeId - Invoice type (1=Consumidor Final)
 * @param {number} orderData.paymentTermId - Payment term (1=Contado)
 * @param {number} orderData.catMhActividadesId - Economic activity ID
 * @param {string} orderData.billingAddress - Billing address
 * @param {string} orderData.shippingAddress - Shipping address
 * @param {Array} orderData.lineItems - Array of { sku, quantity, price, discountPercent }
 * @param {Array} orderData.payments - Array of { paymentMethodId, amount, referenceNumber }
 * @returns {object} ShopifySaleResponse
 */
export async function createErpSale(shop, orderData) {
  const { client, settings } = await getErpClient(shop);

  const payload = {
    ...orderData,
    source: "shopify",
  };

  try {
    const response = await client.post("/api/shopify/sales", payload, {
      params: inventoryParams(settings),
      timeout: 30000, // Sales can take longer
    });
    return response.data;
  } catch (error) {
    throw buildErpError("createErpSale", orderData.shopifyOrderId, error);
  }
}

// ─── Custom Fields (not yet implemented in backend, kept as stubs) ──────────

/**
 * Get custom fields for a product from the ERP
 */
export async function getErpProductCustomFields(shop, sku) {
  // TODO: Implement when backend adds /api/shopify/products/{sku}/customfields
  return {};
}

/**
 * Update custom fields for a product in the ERP
 */
export async function updateErpProductCustomFields(shop, sku, fields) {
  // TODO: Implement when backend adds /api/shopify/products/{sku}/customfields
  return {};
}

/**
 * Get custom fields for a customer from the ERP
 */
export async function getErpCustomerCustomFields(shop, code) {
  // TODO: Implement when backend adds /api/shopify/customers/{code}/customfields
  return {};
}

/**
 * Update custom fields for a customer in the ERP
 */
export async function updateErpCustomerCustomFields(shop, code, fields) {
  // TODO: Implement when backend adds /api/shopify/customers/{code}/customfields
  return {};
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildErpError(operation, identifier, error) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const msg = data?.message;
    const dtl = data?.detail;
    const detail = msg && dtl ? `${msg} ${dtl}` : (msg || dtl || (typeof data === "string" ? data : null) || error.message);
    const url = error.config?.url;

    console.error(`[ERP Error] ${operation} ${url} → ${status}:`, typeof data === "object" ? JSON.stringify(data) : data);

    if (status === 401 || status === 403) {
      return new Error(`ERP: API Key inválida o sin permisos (${status}) en ${operation}. URL: ${url}. Detalle: ${detail}`);
    }
    if (status === 404) {
      return new Error(`ERP: No encontrado${identifier ? ` - ${identifier}` : ""} (404) en ${operation}. URL: ${url}`);
    }
    if (status === 422 || status === 400) {
      return new Error(`ERP: Datos inválidos en ${operation}: ${JSON.stringify(detail)}`);
    }
    if (status >= 500) {
      return new Error(`ERP: Error del servidor (${status}): ${detail}`);
    }
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      return new Error(`ERP: No se puede conectar al servidor. Verifica la URL en Settings.`);
    }
    if (error.code === "ECONNABORTED") {
      return new Error(`ERP: Timeout. El servidor tardó demasiado en responder.`);
    }
    return new Error(`ERP error en ${operation}: ${error.message}`);
  }
  return new Error(`Error inesperado en ${operation}: ${error.message}`);
}
