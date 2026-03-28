/**
 * Shopify Customer Service
 * Wraps Shopify Admin GraphQL API calls for customer and metafield operations
 */

// ─── GraphQL Queries / Mutations ──────────────────────────────────────────────

// Light query for import (no metafields - avoids scope issues during initial import)
const GET_ALL_CUSTOMERS_BASIC = `#graphql
  query GetAllCustomersBasic($cursor: String) {
    customers(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          state
          tags
          defaultAddress {
            address1
            address2
            city
            province
            country
            zip
            phone
            company
          }
        }
      }
    }
  }
`;

// Full query with metafields (for sync operations)
const GET_ALL_CUSTOMERS_WITH_METAFIELDS = `#graphql
  query GetAllCustomersWithMetafields($cursor: String) {
    customers(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          state
          tags
          metafields(first: 50) {
            edges {
              node {
                id
                namespace
                key
                value
                type
              }
            }
          }
          defaultAddress {
            address1
            address2
            city
            province
            country
            zip
            phone
            company
          }
        }
      }
    }
  }
`;

const GET_CUSTOMER = `#graphql
  query GetCustomer($id: ID!) {
    customer(id: $id) {
      id
      firstName
      lastName
      email
      phone
      state
      tags
      metafields(first: 50) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
      defaultAddress {
        address1
        address2
        city
        province
        country
        zip
        phone
        company
      }
    }
  }
`;

const CUSTOMER_UPDATE = `#graphql
  mutation CustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer {
        id
        firstName
        lastName
        email
        phone
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SET_METAFIELDS = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        value
        type
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCT_METAFIELDS = `#graphql
  query GetProductMetafields($id: ID!) {
    product(id: $id) {
      id
      metafields(first: 50) {
        edges {
          node {
            id
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

// ─── Service Functions ─────────────────────────────────────────────────────────

/**
 * Get all customers (paginated)
 * @param {boolean} includeMetafields - Whether to fetch metafields (requires read_customers scope)
 */
export async function getAllCustomers(graphql, { includeMetafields = false } = {}) {
  const allCustomers = [];
  let cursor = null;
  const query = includeMetafields ? GET_ALL_CUSTOMERS_WITH_METAFIELDS : GET_ALL_CUSTOMERS_BASIC;

  do {
    const response = await graphql(query, {
      variables: { cursor },
    });
    const data = await response.json();
    const { edges, pageInfo } = data.data.customers;

    for (const { node: customer } of edges) {
      allCustomers.push({
        ...customer,
        metafields: customer.metafields
          ? customer.metafields.edges.map(({ node }) => node)
          : [],
      });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return allCustomers;
}

/**
 * Get a single customer by ID
 */
export async function getCustomer(graphql, customerId) {
  const response = await graphql(GET_CUSTOMER, {
    variables: { id: customerId },
  });
  const data = await response.json();
  const customer = data.data.customer;
  if (!customer) return null;

  return {
    ...customer,
    metafields: customer.metafields.edges.map(({ node }) => node),
  };
}

/**
 * Update a customer's basic info in Shopify
 */
export async function updateShopifyCustomer(graphql, customerId, customerData) {
  const input = {
    id: customerId,
    ...customerData,
  };

  const response = await graphql(CUSTOMER_UPDATE, {
    variables: { input },
  });
  const data = await response.json();
  const result = data.data.customerUpdate;

  if (result.userErrors && result.userErrors.length > 0) {
    const errors = result.userErrors.map((e) => e.message).join(", ");
    throw new Error(`Shopify customer error: ${errors}`);
  }

  return result.customer;
}

/**
 * Set metafields on a Shopify resource (customer or product)
 * @param {string} ownerId - The GID of the resource (e.g. gid://shopify/Customer/123)
 * @param {Array<{ namespace: string, key: string, value: string, type: string }>} fields
 */
export async function setMetafields(graphql, ownerId, fields) {
  if (!fields || fields.length === 0) return [];

  const metafields = fields.map((field) => ({
    ownerId,
    namespace: field.namespace,
    key: field.key,
    value: String(field.value),
    type: field.type || "single_line_text_field",
  }));

  const response = await graphql(SET_METAFIELDS, {
    variables: { metafields },
  });
  const data = await response.json();
  const result = data.data.metafieldsSet;

  if (result.userErrors && result.userErrors.length > 0) {
    const errors = result.userErrors.map((e) => e.message).join(", ");
    throw new Error(`Shopify metafield error: ${errors}`);
  }

  return result.metafields;
}

/**
 * Get metafields for a product
 */
export async function getProductMetafields(graphql, productId) {
  const response = await graphql(GET_PRODUCT_METAFIELDS, {
    variables: { id: productId },
  });
  const data = await response.json();
  const product = data.data.product;
  if (!product) return [];

  return product.metafields.edges.map(({ node }) => node);
}

/**
 * Create metafield definitions for customer MH catalog fields.
 * These definitions make the fields visible in the Shopify Admin UI.
 */
const CREATE_METAFIELD_DEFINITION = `#graphql
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
        namespace
        key
        name
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CUSTOMER_METAFIELD_DEFINITIONS = [
  { namespace: "custom", key: "customer_dui", name: "DUI / NIT", type: "single_line_text_field", description: "Documento Único de Identidad o NIT del cliente" },
  { namespace: "custom", key: "tipo_documento_id", name: "Tipo de Documento", type: "number_integer", description: "ID del catálogo MH de tipo de documento (DUI=2, NIT=3, etc.)" },
  { namespace: "custom", key: "tipo_persona_id", name: "Tipo de Persona", type: "number_integer", description: "ID del catálogo MH de tipo de persona (Natural=1, Jurídica=2)" },
  { namespace: "custom", key: "customer_type_id", name: "Tipo de Cliente", type: "number_integer", description: "ID del tipo de cliente en el ERP" },
  { namespace: "custom", key: "actividad_economica_id", name: "Actividad Económica", type: "number_integer", description: "ID del catálogo MH de actividad económica" },
  { namespace: "custom", key: "taxpayer_type_id", name: "Tipo de Contribuyente", type: "number_integer", description: "ID del tipo de contribuyente (Grande, Mediano, Otro)" },
  { namespace: "custom", key: "is_taxpayer", name: "Es Contribuyente", type: "boolean", description: "Indica si el cliente es contribuyente" },
  { namespace: "custom", key: "is_foreigner", name: "Es Extranjero", type: "boolean", description: "Indica si el cliente es extranjero" },
  { namespace: "custom", key: "company_nrc", name: "NRC", type: "single_line_text_field", description: "Número de Registro de Contribuyente" },
  { namespace: "custom", key: "company_number", name: "Número de Empresa", type: "single_line_text_field", description: "Número de registro de empresa" },
  { namespace: "custom", key: "departamento_id", name: "Departamento", type: "number_integer", description: "ID del catálogo MH de departamento" },
  { namespace: "custom", key: "municipio_id", name: "Municipio", type: "number_integer", description: "ID del catálogo MH de municipio" },
  { namespace: "custom", key: "distrito_id", name: "Distrito", type: "number_integer", description: "ID del catálogo MH de distrito" },
];

export async function createCustomerMetafieldDefinitions(graphql) {
  const results = { created: 0, skipped: 0, errors: [] };

  for (const def of CUSTOMER_METAFIELD_DEFINITIONS) {
    try {
      const response = await graphql(CREATE_METAFIELD_DEFINITION, {
        variables: {
          definition: {
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            type: def.type,
            description: def.description,
            ownerType: "CUSTOMER",
            pin: true,
          },
        },
      });

      const data = await response.json();
      const userErrors = data.data.metafieldDefinitionCreate.userErrors;

      if (userErrors && userErrors.length > 0) {
        const alreadyExists = userErrors.some((e) => e.message.includes("already exists") || e.message.includes("taken"));
        if (alreadyExists) {
          results.skipped++;
        } else {
          results.errors.push(`${def.key}: ${userErrors.map((e) => e.message).join(", ")}`);
        }
      } else {
        results.created++;
      }
    } catch (error) {
      results.errors.push(`${def.key}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Convert ERP custom fields to Shopify metafield format using field mappings
 * @param {object} erpFields - Key-value pairs from ERP
 * @param {Array} fieldMappings - CustomFieldMapping records
 * @returns {Array<{ namespace: string, key: string, value: string, type: string }>}
 */
export function erpFieldsToShopifyMetafields(erpFields, fieldMappings) {
  const metafields = [];

  for (const mapping of fieldMappings) {
    if (!mapping.syncEnabled) continue;

    const erpValue = erpFields[mapping.erpField];
    if (erpValue === undefined || erpValue === null) continue;

    const [namespace, key] = mapping.shopifyField.split(".");
    if (!namespace || !key) continue;

    metafields.push({
      namespace,
      key,
      value: String(erpValue),
      type: detectMetafieldType(erpValue),
    });
  }

  return metafields;
}

/**
 * Convert Shopify metafields to ERP custom field format using field mappings
 * @param {Array} metafields - Shopify metafield objects
 * @param {Array} fieldMappings - CustomFieldMapping records
 * @returns {object} Key-value pairs for ERP
 */
export function shopifyMetafieldsToErpFields(metafields, fieldMappings) {
  const erpFields = {};

  for (const mapping of fieldMappings) {
    if (!mapping.syncEnabled) continue;

    const [namespace, key] = mapping.shopifyField.split(".");
    const metafield = metafields.find(
      (m) => m.namespace === namespace && m.key === key
    );

    if (metafield) {
      erpFields[mapping.erpField] = metafield.value;
    }
  }

  return erpFields;
}

/**
 * Detect Shopify metafield type from value
 */
function detectMetafieldType(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? "number_integer" : "number_decimal";
  }
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "json";
  return "single_line_text_field";
}
