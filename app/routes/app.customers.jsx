/**
 * Customer Mapping Page
 * Map Shopify customers to ERP customer codes and manage sync
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
  EmptyState,
  Checkbox,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";
import {
  getAllCustomers,
  getCustomer,
  shopifyMetafieldsToErpFields,
} from "../services/shopify-customers.server.js";
import {
  getCustomerSyncStats,
  fullSyncCustomersShopifyToErp,
} from "../services/customer-sync.server.js";

const PAGE_SIZE = 20;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const search = url.searchParams.get("search") || "";

  const where = {
    shop,
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { erpCustomerCode: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, mappings, stats, customFieldMappings] = await Promise.all([
    db.customerMapping.count({ where }),
    db.customerMapping.findMany({
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    getCustomerSyncStats(shop),
    db.customFieldMapping.findMany({
      where: { shop, resourceType: "CUSTOMER", syncEnabled: true },
      orderBy: { shopifyField: "asc" },
    }),
  ]);

  // Fetch Shopify metafields for each customer on this page and extract custom field values
  const customFieldValues = {};
  if (customFieldMappings.length > 0) {
    const metafieldResults = await Promise.allSettled(
      mappings.map((m) => getCustomer(admin.graphql, m.shopifyCustomerId))
    );
    for (let i = 0; i < mappings.length; i++) {
      const result = metafieldResults[i];
      if (result.status === "fulfilled" && result.value) {
        customFieldValues[mappings[i].id] = shopifyMetafieldsToErpFields(
          result.value.metafields || [],
          customFieldMappings
        );
      } else {
        customFieldValues[mappings[i].id] = {};
      }
    }
  }

  return json({
    mappings,
    total,
    page,
    pageSize: PAGE_SIZE,
    stats,
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
    try {
      const customers = await getAllCustomers(admin.graphql);
      let created = 0;
      let updated = 0;

      for (const customer of customers) {
        const result = await db.customerMapping.upsert({
          where: {
            shop_shopifyCustomerId: {
              shop,
              shopifyCustomerId: customer.id,
            },
          },
          update: {
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            syncEnabled: true,
          },
          create: {
            shop,
            shopifyCustomerId: customer.id,
            erpCustomerCode: "",
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            syncEnabled: true,
          },
        });

        if (result.createdAt.getTime() === result.updatedAt.getTime()) {
          created++;
        } else {
          updated++;
        }
      }

      return json({
        success: `Importación completada: ${created} clientes nuevos, ${updated} actualizados.`,
      });
    } catch (err) {
      return json({ error: `Error al importar: ${err.message}` }, { status: 500 });
    }
  }

  if (intent === "full-sync") {
    try {
      const results = await fullSyncCustomersShopifyToErp({
        shop,
        graphql: admin.graphql,
        source: "manual",
      });
      return json({ success: `Sincronización completada: ${results.success} exitosos, ${results.failed} fallidos, ${results.skipped} omitidos.` });
    } catch (err) {
      return json({ error: `Error en sincronización: ${err.message}` }, { status: 500 });
    }
  }

  if (intent === "update-mapping") {
    const id = formData.get("id");
    const erpCustomerCode = formData.get("erpCustomerCode")?.toString().trim();
    const syncEnabled = formData.get("syncEnabled") === "true";

    if (!id) return json({ error: "ID requerido" }, { status: 400 });

    await db.customerMapping.update({
      where: { id },
      data: { erpCustomerCode, syncEnabled },
    });

    return json({ success: "Mapeo actualizado" });
  }

  if (intent === "delete-mapping") {
    const id = formData.get("id");
    await db.customerMapping.delete({ where: { id } });
    return json({ success: "Mapeo eliminado" });
  }

  if (intent === "toggle-sync") {
    const id = formData.get("id");
    const current = await db.customerMapping.findUnique({ where: { id } });
    await db.customerMapping.update({
      where: { id },
      data: { syncEnabled: !current.syncEnabled },
    });
    return json({ success: "Estado actualizado" });
  }

  return json({ error: "Acción no válida" }, { status: 400 });
};

export default function Customers() {
  const { mappings, total, page, pageSize, stats, customFieldMappings, customFieldValues } = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [editModal, setEditModal] = useState(null);
  const [editCode, setEditCode] = useState("");
  const [editSync, setEditSync] = useState(true);

  const totalPages = Math.ceil(total / pageSize);
  const isImporting = fetcher.state !== "idle";

  const openEdit = (mapping) => {
    setEditModal(mapping);
    setEditCode(mapping.erpCustomerCode || "");
    setEditSync(mapping.syncEnabled);
  };

  const closeEdit = () => setEditModal(null);

  const saveEdit = () => {
    fetcher.submit(
      {
        intent: "update-mapping",
        id: editModal.id,
        erpCustomerCode: editCode,
        syncEnabled: String(editSync),
      },
      { method: "POST" }
    );
    closeEdit();
  };

  const rows = mappings.map((m) => {
    const cfValues = customFieldValues[m.id] || {};
    const customCols = customFieldMappings.map((cf) => cfValues[cf.erpField] || "—");

    return [
      <BlockStack gap="100">
        <Text fontWeight="semibold">
          {[m.firstName, m.lastName].filter(Boolean).join(" ") || "Sin nombre"}
        </Text>
        {m.email && (
          <Text tone="subdued" variant="bodySm">
            {m.email}
          </Text>
        )}
      </BlockStack>,
      m.phone || "—",
      m.erpCustomerCode || <Badge tone="warning">Sin mapear</Badge>,
      m.shopifyCustomerId?.split("/").pop() || "—",
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
      title="Mapeo de Clientes"
      subtitle="Vincula clientes de Shopify con códigos de tu ERP"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: isImporting ? "Importando..." : "Importar desde Shopify",
        loading: isImporting,
        onAction: () => {
          fetcher.submit({ intent: "import-from-shopify" }, { method: "POST" });
        },
      }}
      secondaryActions={[
        {
          content: "Sincronizar a ERP",
          onAction: () => {
            fetcher.submit({ intent: "full-sync" }, { method: "POST" });
          },
        },
      ]}
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

        {/* Stats */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Clientes Mapeados</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {stats.totalMappings}
                </Text>
                <Text tone="subdued">{stats.enabledMappings} activos</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Syncs Exitosos</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold" tone="success">
                  {stats.successLogs}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Campos Personalizados</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {stats.customFieldMappings}
                </Text>
                <Button url="/app/custom-fields" variant="plain" size="slim">
                  Configurar
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text>{total} clientes mapeados</Text>
              <InlineStack gap="200">
                <input
                  placeholder="Buscar por nombre, email o código..."
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
                    width: 300,
                  }}
                />
              </InlineStack>
            </InlineStack>

            {mappings.length === 0 ? (
              <EmptyState
                heading="Sin clientes mapeados"
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
                  clientes y luego asigna el código del ERP a cada uno.
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
                    "Cliente",
                    "Teléfono",
                    "Código ERP",
                    "ID Shopify",
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
          title={`Editar mapeo: ${[editModal.firstName, editModal.lastName].filter(Boolean).join(" ")}`}
          primaryAction={{ content: "Guardar", onAction: saveEdit }}
          secondaryActions={[{ content: "Cancelar", onAction: closeEdit }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text>
                <strong>Email:</strong> {editModal.email || "—"}
              </Text>
              <Text tone="subdued">
                <strong>Shopify ID:</strong> {editModal.shopifyCustomerId?.split("/").pop()}
              </Text>
              <TextField
                label="Código del ERP"
                value={editCode}
                onChange={setEditCode}
                autoComplete="off"
                helpText="Ingresa el código de cliente exacto tal como aparece en tu ERP"
              />
              <Checkbox
                label="Sincronización activa"
                checked={editSync}
                onChange={setEditSync}
                helpText="Activa para incluir este cliente en la sincronización automática"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
