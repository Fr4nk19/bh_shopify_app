/**
 * Product Mapping Page
 * Map Shopify variants to ERP SKUs
 */

import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useFetcher,
  useSearchParams,
} from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  BlockStack,
  InlineStack,
  Button,
  Text,
  TextField,
  Modal,
  Banner,
  Pagination,
  Select,
  EmptyState,
  Checkbox,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";
import {
  getAllProductsWithInventory,
  getShopLocations,
} from "../services/shopify-inventory.server.js";
import {
  getProductMetafields,
  shopifyMetafieldsToErpFields,
} from "../services/shopify-customers.server.js";

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const search = url.searchParams.get("search") || "";

  // Get existing mappings
  const where = {
    shop,
    ...(search
      ? {
          OR: [
            { productTitle: { contains: search, mode: "insensitive" } },
            { erpSku: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, mappings, locations, customFieldMappings] = await Promise.all([
    db.productMapping.count({ where }),
    db.productMapping.findMany({
      where,
      orderBy: [{ productTitle: "asc" }, { variantTitle: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getShopLocations(admin.graphql),
    db.customFieldMapping.findMany({
      where: { shop, resourceType: "PRODUCT", syncEnabled: true },
      orderBy: { shopifyField: "asc" },
    }),
  ]);

  // Fetch Shopify metafields for each product on this page and extract custom field values
  const customFieldValues = {};
  if (customFieldMappings.length > 0) {
    // Deduplicate product IDs (multiple variants/locations may share the same product)
    const uniqueProductIds = [...new Set(mappings.map((m) => m.shopifyProductId))];
    const metafieldsByProduct = {};

    const metafieldResults = await Promise.allSettled(
      uniqueProductIds.map((pid) => getProductMetafields(admin.graphql, pid))
    );
    for (let i = 0; i < uniqueProductIds.length; i++) {
      const result = metafieldResults[i];
      metafieldsByProduct[uniqueProductIds[i]] =
        result.status === "fulfilled" ? result.value : [];
    }

    for (const m of mappings) {
      const metafields = metafieldsByProduct[m.shopifyProductId] || [];
      customFieldValues[m.id] = shopifyMetafieldsToErpFields(metafields, customFieldMappings);
    }
  }

  return json({
    mappings,
    total,
    page,
    pageSize: PAGE_SIZE,
    locations,
    shop,
    customFieldMappings,
    customFieldValues,
  });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "import-from-shopify") {
    // Import all Shopify products and auto-populate mappings
    try {
      const products = await getAllProductsWithInventory(admin.graphql);
      let created = 0;
      let skipped = 0;

      for (const product of products) {
        for (const variant of product.variants) {
          if (!variant.sku) { skipped++; continue; }

          for (const level of variant.inventoryLevels) {
            await db.productMapping.upsert({
              where: {
                shop_shopifyVariantId_shopifyLocationId: {
                  shop,
                  shopifyVariantId: variant.id,
                  shopifyLocationId: level.locationId,
                },
              },
              update: {
                productTitle: product.title,
                variantTitle:
                  variant.title !== "Default Title" ? variant.title : null,
                shopifyInventoryItemId: variant.inventoryItem?.id || "",
              },
              create: {
                shop,
                shopifyProductId: product.id,
                shopifyVariantId: variant.id,
                shopifyInventoryItemId: variant.inventoryItem?.id || "",
                shopifyLocationId: level.locationId,
                productTitle: product.title,
                variantTitle:
                  variant.title !== "Default Title" ? variant.title : null,
                erpSku: variant.sku, // Use Shopify SKU as default ERP SKU
                syncEnabled: false, // Must be confirmed by user
              },
            });
            created++;
          }
        }
      }

      return json({
        success: `Importación completada: ${created} variantes importadas, ${skipped} omitidas (sin SKU).`,
      });
    } catch (err) {
      return json({ error: `Error al importar: ${err.message}` }, { status: 500 });
    }
  }

  if (intent === "update-mapping") {
    const id = formData.get("id");
    const erpSku = formData.get("erpSku")?.toString().trim();
    const syncEnabled = formData.get("syncEnabled") === "true";

    if (!id) return json({ error: "ID requerido" }, { status: 400 });

    await db.productMapping.update({
      where: { id },
      data: { erpSku, syncEnabled },
    });

    return json({ success: "Mapeo actualizado" });
  }

  if (intent === "delete-mapping") {
    const id = formData.get("id");
    await db.productMapping.delete({ where: { id } });
    return json({ success: "Mapeo eliminado" });
  }

  if (intent === "toggle-sync") {
    const id = formData.get("id");
    const current = await db.productMapping.findUnique({ where: { id } });
    await db.productMapping.update({
      where: { id },
      data: { syncEnabled: !current.syncEnabled },
    });
    return json({ success: "Estado actualizado" });
  }

  return json({ error: "Acción no válida" }, { status: 400 });
};

export default function Products() {
  const { mappings, total, page, pageSize, locations, customFieldMappings, customFieldValues } = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [editModal, setEditModal] = useState(null); // { id, erpSku, syncEnabled }
  const [editSku, setEditSku] = useState("");
  const [editSync, setEditSync] = useState(true);

  const totalPages = Math.ceil(total / pageSize);
  const isImporting = fetcher.state !== "idle";

  const openEdit = (mapping) => {
    setEditModal(mapping);
    setEditSku(mapping.erpSku || "");
    setEditSync(mapping.syncEnabled);
  };

  const closeEdit = () => setEditModal(null);

  const saveEdit = () => {
    fetcher.submit(
      {
        intent: "update-mapping",
        id: editModal.id,
        erpSku: editSku,
        syncEnabled: String(editSync),
      },
      { method: "POST" }
    );
    closeEdit();
  };

  const locationName = (locationId) => {
    const loc = locations.find((l) => l.id === locationId);
    return loc?.name || locationId?.split("/").pop() || "—";
  };

  const rows = mappings.map((m) => {
    const cfValues = customFieldValues[m.id] || {};
    const customCols = customFieldMappings.map((cf) => cfValues[cf.erpField] || "—");

    return [
      <BlockStack gap="100">
        <Text fontWeight="semibold">{m.productTitle}</Text>
        {m.variantTitle && <Text tone="subdued" variant="bodySm">{m.variantTitle}</Text>}
      </BlockStack>,
      locationName(m.shopifyLocationId),
      m.erpSku || <Badge tone="warning">Sin mapear</Badge>,
      m.shopifyVariantId?.split("/").pop() || "—",
      ...customCols,
      m.syncEnabled ? (
        <Badge tone="success">Activo</Badge>
      ) : (
        <Badge tone="subdued">Inactivo</Badge>
      ),
      <InlineStack gap="200">
        <Button size="slim" onClick={() => openEdit(m)}>
          Editar
        </Button>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="toggle-sync" />
          <input type="hidden" name="id" value={m.id} />
          <Button size="slim" submit variant="plain">
            {m.syncEnabled ? "Pausar" : "Activar"}
          </Button>
        </fetcher.Form>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="delete-mapping" />
          <input type="hidden" name="id" value={m.id} />
          <Button size="slim" submit variant="plain" tone="critical">
            Eliminar
          </Button>
        </fetcher.Form>
      </InlineStack>,
    ];
  });

  return (
    <Page
      title="Mapeo de Productos"
      subtitle="Vincula variantes de Shopify con SKUs de tu ERP"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: isImporting ? "Importando..." : "Importar desde Shopify",
        loading: isImporting,
        onAction: () => {
          fetcher.submit({ intent: "import-from-shopify" }, { method: "POST" });
        },
      }}
    >
      <BlockStack gap="400">
        {(actionData?.error || fetcher.data?.error) && (
          <Banner tone="critical" title="Error">
            <p>{actionData?.error || fetcher.data?.error}</p>
          </Banner>
        )}
        {(actionData?.success || fetcher.data?.success) && (
          <Banner tone="success" title="Éxito">
            <p>{actionData?.success || fetcher.data?.success}</p>
          </Banner>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text>{total} productos mapeados</Text>
              <InlineStack gap="200">
                <input
                  placeholder="Buscar por producto o SKU..."
                  defaultValue={searchParams.get("search") || ""}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const next = new URLSearchParams(searchParams);
                      next.set("search", e.target.value);
                      next.delete("page");
                      setSearchParams(next);
                    }
                  }}
                  style={{
                    padding: "6px 12px",
                    border: "1px solid #c9cccf",
                    borderRadius: 4,
                    fontSize: 14,
                    width: 250,
                  }}
                />
              </InlineStack>
            </InlineStack>

            {mappings.length === 0 ? (
              <EmptyState
                heading="Sin productos mapeados"
                image=""
                action={{
                  content: "Importar desde Shopify",
                  onAction: () => {
                    fetcher.submit(
                      { intent: "import-from-shopify" },
                      { method: "POST" }
                    );
                  },
                }}
              >
                <p>
                  Haz clic en "Importar desde Shopify" para cargar todos tus
                  productos y luego asigna el SKU del ERP a cada variante.
                </p>
              </EmptyState>
            ) : (
              <>
                <DataTable
                  columnContentTypes={[
                    "text", "text", "text", "text",
                    ...customFieldMappings.map(() => "text"),
                    "text", "text",
                  ]}
                  headings={[
                    "Producto / Variante",
                    "Ubicación",
                    "SKU ERP",
                    "Variant ID Shopify",
                    ...customFieldMappings.map((cf) => cf.erpField),
                    "Estado Sync",
                    "Acciones",
                  ]}
                  rows={rows}
                  truncate
                />
                {totalPages > 1 && (
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("page", String(page - 1));
                        setSearchParams(next);
                      }}
                      hasNext={page < totalPages}
                      onNext={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set("page", String(page + 1));
                        setSearchParams(next);
                      }}
                    />
                  </InlineStack>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Edit Modal */}
      {editModal && (
        <Modal
          open
          onClose={closeEdit}
          title={`Editar mapeo: ${editModal.productTitle}`}
          primaryAction={{ content: "Guardar", onAction: saveEdit }}
          secondaryActions={[{ content: "Cancelar", onAction: closeEdit }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text>
                <strong>Variante:</strong> {editModal.variantTitle || "Default"}
              </Text>
              <Text tone="subdued">
                <strong>Variant ID:</strong> {editModal.shopifyVariantId?.split("/").pop()}
              </Text>
              <TextField
                label="SKU del ERP"
                value={editSku}
                onChange={setEditSku}
                autoComplete="off"
                helpText="Ingresa el código de SKU exacto tal como aparece en tu ERP"
              />
              <Checkbox
                label="Sincronización activa"
                checked={editSync}
                onChange={setEditSync}
                helpText="Activa para incluir esta variante en la sincronización automática"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
