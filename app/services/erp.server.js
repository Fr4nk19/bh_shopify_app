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
