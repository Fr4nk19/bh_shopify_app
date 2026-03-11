/**
 * Shopify Inventory Service
 * Wraps Shopify Admin GraphQL API calls for inventory operations
 */

// ─── GraphQL Queries / Mutations ──────────────────────────────────────────────

const GET_PRODUCT_VARIANTS = `#graphql
  query GetProductVariants($productId: ID!) {
    product(id: $productId) {
      id
      title
      variants(first: 100) {
        edges {
          node {
            id
            title
            sku
            inventoryItem {
              id
              inventoryLevels(first: 10) {
                edges {
                  node {
                    id
                    location {
                      id
                      name
                    }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_ALL_PRODUCTS_WITH_INVENTORY = `#graphql
  query GetAllProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          variants(first: 50) {
            edges {
              node {
                id
                title
                sku
                inventoryItem {
                  id
                  inventoryLevels(first: 10) {
                    edges {
                      node {
                        id
                        location {
                          id
                          name
                        }
                        quantities(names: ["available"]) {
                          name
                          quantity
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const GET_LOCATIONS = `#graphql
  query GetLocations {
    locations(first: 20) {
      edges {
        node {
          id
          name
          isActive
        }
      }
    }
  }
`;

const SET_INVENTORY_QUANTITY = `#graphql
  mutation SetInventoryQuantity($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup {
        id
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const GET_INVENTORY_LEVEL = `#graphql
  query GetInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
    inventoryLevel(inventoryItemId: $inventoryItemId, locationId: $locationId) {
      id
      quantities(names: ["available"]) {
        name
        quantity
      }
    }
  }
`;

// ─── Service Functions ─────────────────────────────────────────────────────────

/**
 * Get all locations for a shop
 */
export async function getShopLocations(graphql) {
  const response = await graphql(GET_LOCATIONS);
  const data = await response.json();
  return data.data.locations.edges.map((e) => e.node);
}

/**
 * Get all products with their variants and inventory levels (paginated)
 */
export async function getAllProductsWithInventory(graphql) {
  const allProducts = [];
  let cursor = null;

  do {
    const response = await graphql(GET_ALL_PRODUCTS_WITH_INVENTORY, {
      variables: { cursor },
    });
    const data = await response.json();
    const { edges, pageInfo } = data.data.products;

    for (const { node: product } of edges) {
      const variants = product.variants.edges.map(({ node: variant }) => {
        const levels = variant.inventoryItem?.inventoryLevels?.edges || [];
        return {
          ...variant,
          inventoryLevels: levels.map(({ node: level }) => ({
            id: level.id,
            locationId: level.location.id,
            locationName: level.location.name,
            available:
              level.quantities.find((q) => q.name === "available")?.quantity ?? 0,
          })),
        };
      });
      allProducts.push({ ...product, variants });
    }

    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  return allProducts;
}

/**
 * Get current inventory level for an inventory item at a location
 */
export async function getInventoryLevel(graphql, inventoryItemId, locationId) {
  const response = await graphql(GET_INVENTORY_LEVEL, {
    variables: { inventoryItemId, locationId },
  });
  const data = await response.json();
  const level = data.data.inventoryLevel;
  if (!level) return null;
  return {
    id: level.id,
    available:
      level.quantities.find((q) => q.name === "available")?.quantity ?? 0,
  };
}

/**
 * Set inventory quantity for an inventory item at a location
 * Uses the newer inventorySetQuantities mutation (2024+)
 */
export async function setInventoryQuantity(
  graphql,
  inventoryItemId,
  locationId,
  quantity,
  reason = "correction"
) {
  const response = await graphql(SET_INVENTORY_QUANTITY, {
    variables: {
      input: {
        reason,
        name: "available",
        quantities: [
          {
            inventoryItemId,
            locationId,
            quantity,
          },
        ],
      },
    },
  });

  const data = await response.json();
  const result = data.data.inventorySetQuantities;

  if (result.userErrors && result.userErrors.length > 0) {
    const errors = result.userErrors.map((e) => e.message).join(", ");
    throw new Error(`Shopify inventory error: ${errors}`);
  }

  return result.inventoryAdjustmentGroup;
}

/**
 * Get product variants with inventory by product ID
 */
export async function getProductVariants(graphql, productId) {
  const response = await graphql(GET_PRODUCT_VARIANTS, {
    variables: { productId },
  });
  const data = await response.json();
  return data.data.product;
}

/**
 * Extract numeric ID from Shopify GID
 * e.g. "gid://shopify/InventoryItem/12345" → "12345"
 */
export function extractShopifyId(gid) {
  return gid?.split("/").pop() ?? gid;
}
