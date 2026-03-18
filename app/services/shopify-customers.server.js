/**
 * Shopify Customer Service
 * Wraps Shopify Admin GraphQL API calls for customer and metafield operations
 */

// ─── GraphQL Queries / Mutations ──────────────────────────────────────────────

const GET_ALL_CUSTOMERS = `#graphql
  query GetAllCustomers($cursor: String) {
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
 * Get all customers with metafields (paginated)
 */
export async function getAllCustomers(graphql) {
  const allCustomers = [];
  let cursor = null;

  do {
    const response = await graphql(GET_ALL_CUSTOMERS, {
      variables: { cursor },
    });
    const data = await response.json();
    const { edges, pageInfo } = data.data.customers;

    for (const { node: customer } of edges) {
      allCustomers.push({
        ...customer,
        metafields: customer.metafields.edges.map(({ node }) => node),
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
