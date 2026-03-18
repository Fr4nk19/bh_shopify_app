/**
 * ERP Client Service
 * Handles all communication with the C# ERP REST API
 *
 * Expected ERP endpoints:
 *   GET    /api/inventory              → list all inventory items
 *   GET    /api/inventory/{sku}        → get inventory for a SKU
 *   PUT    /api/inventory/{sku}        → update inventory for a SKU
 *   GET    /api/products               → list all products
 *   GET    /api/products/{sku}         → get product by SKU
 *   GET    /api/customers              → list all customers
 *   GET    /api/customers/{code}       → get customer by code
 *   PUT    /api/customers/{code}       → update customer in ERP
 *   POST   /api/customers              → create customer in ERP
 *   GET    /api/products/{sku}/customfields    → get product custom fields
 *   PUT    /api/products/{sku}/customfields    → update product custom fields
 *   GET    /api/customers/{code}/customfields  → get customer custom fields
 *   PUT    /api/customers/{code}/customfields  → update customer custom fields
 */

import axios from "axios";
import { db } from "../db.server.js";

/**
 * Build an axios instance configured for a specific shop's ERP
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
        [settings.erpApiHeader]: settings.erpApiKey,
      },
    }),
    settings,
  };
}

/**
 * Get inventory level for a specific SKU from ERP
 * @returns {{ sku: string, quantity: number, location?: string, updatedAt?: string }}
 */
export async function getErpInventory(shop, sku) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get(`/api/inventory/${encodeURIComponent(sku)}`);
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
  const { client } = await getErpClient(shop);

  const payload = {
    sku,
    quantity,
    source: "shopify",
    updatedAt: new Date().toISOString(),
    ...meta,
  };

  try {
    const response = await client.put(
      `/api/inventory/${encodeURIComponent(sku)}`,
      payload
    );
    return response.data;
  } catch (error) {
    throw buildErpError("updateErpInventory", sku, error);
  }
}

/**
 * Get all inventory items from the ERP
 * @returns {Array<{ sku: string, quantity: number, updatedAt: string }>}
 */
export async function getAllErpInventory(shop) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get("/api/inventory");
    // Support both { items: [...] } and direct array responses
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpInventory", null, error);
  }
}

/**
 * Get all products from the ERP
 * @returns {Array<{ sku: string, name: string, description?: string }>}
 */
export async function getAllErpProducts(shop) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get("/api/products");
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpProducts", null, error);
  }
}

/**
 * Test ERP connection with current settings
 * @returns {{ success: boolean, message: string, erpVersion?: string }}
 */
export async function testErpConnection(shop) {
  try {
    const { client } = await getErpClient(shop);
    // Try a lightweight endpoint first, fallback to /api/inventory
    try {
      const res = await client.get("/api/health");
      return { success: true, message: "Conexión exitosa", data: res.data };
    } catch {
      const res = await client.get("/api/inventory");
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      return {
        success: true,
        message: `Conexión exitosa. ${items.length} productos encontrados en el ERP.`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: buildErpError("testErpConnection", null, error).message,
    };
  }
}

// ─── Customers ──────────────────────────────────────────────────────────────

/**
 * Get all customers from the ERP
 * @returns {Array<{ code: string, firstName: string, lastName: string, email: string, phone?: string, customFields?: object }>}
 */
export async function getAllErpCustomers(shop) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get("/api/customers");
    return Array.isArray(response.data) ? response.data : response.data.items || [];
  } catch (error) {
    throw buildErpError("getAllErpCustomers", null, error);
  }
}

/**
 * Get a specific customer from the ERP by code
 */
export async function getErpCustomer(shop, code) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get(`/api/customers/${encodeURIComponent(code)}`);
    return response.data;
  } catch (error) {
    throw buildErpError("getErpCustomer", code, error);
  }
}

/**
 * Create or update a customer in the ERP
 */
export async function upsertErpCustomer(shop, code, customerData) {
  const { client } = await getErpClient(shop);

  const payload = {
    code,
    ...customerData,
    source: "shopify",
    updatedAt: new Date().toISOString(),
  };

  try {
    const response = await client.put(
      `/api/customers/${encodeURIComponent(code)}`,
      payload
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      // Customer doesn't exist, create it
      try {
        const createResponse = await client.post("/api/customers", payload);
        return createResponse.data;
      } catch (createError) {
        throw buildErpError("createErpCustomer", code, createError);
      }
    }
    throw buildErpError("upsertErpCustomer", code, error);
  }
}

// ─── Custom Fields ──────────────────────────────────────────────────────────

/**
 * Get custom fields for a product from the ERP
 */
export async function getErpProductCustomFields(shop, sku) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get(`/api/products/${encodeURIComponent(sku)}/customfields`);
    return response.data || {};
  } catch (error) {
    if (error.response?.status === 404) return {};
    throw buildErpError("getErpProductCustomFields", sku, error);
  }
}

/**
 * Update custom fields for a product in the ERP
 */
export async function updateErpProductCustomFields(shop, sku, fields) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.put(
      `/api/products/${encodeURIComponent(sku)}/customfields`,
      { fields, source: "shopify", updatedAt: new Date().toISOString() }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("updateErpProductCustomFields", sku, error);
  }
}

/**
 * Get custom fields for a customer from the ERP
 */
export async function getErpCustomerCustomFields(shop, code) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.get(`/api/customers/${encodeURIComponent(code)}/customfields`);
    return response.data || {};
  } catch (error) {
    if (error.response?.status === 404) return {};
    throw buildErpError("getErpCustomerCustomFields", code, error);
  }
}

/**
 * Update custom fields for a customer in the ERP
 */
export async function updateErpCustomerCustomFields(shop, code, fields) {
  const { client } = await getErpClient(shop);

  try {
    const response = await client.put(
      `/api/customers/${encodeURIComponent(code)}/customfields`,
      { fields, source: "shopify", updatedAt: new Date().toISOString() }
    );
    return response.data;
  } catch (error) {
    throw buildErpError("updateErpCustomerCustomFields", code, error);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildErpError(operation, sku, error) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail = error.response?.data?.message || error.response?.data || error.message;

    if (status === 401 || status === 403) {
      return new Error(`ERP: API Key inválida o sin permisos (${status})`);
    }
    if (status === 404) {
      return new Error(`ERP: SKU no encontrado${sku ? ` - ${sku}` : ""} (404)`);
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
