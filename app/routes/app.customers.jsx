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
  Select,
} from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";
import {
  getAllCustomers,
  getCustomer,
  shopifyMetafieldsToErpFields,
  createCustomerMetafieldDefinitions,
} from "../services/shopify-customers.server.js";
import {
  getCustomerSyncStats,
  fullSyncCustomersShopifyToErp,
} from "../services/customer-sync.server.js";
import { getErpCatalogs } from "../services/erp.server.js";

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

  const [total, mappings, stats, customFieldMappings, catalogs] = await Promise.all([
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
    getErpCatalogs(shop).catch((err) => {
      console.error("[Loader] Failed to load catalogs:", err.message);
      return null;
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
    catalogs,
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
      const detailLines = (results.details || [])
        .filter(d => d.status !== "success")
        .map(d => `${d.id}: ${d.status} - ${d.reason || d.error || ""}`)
        .join(" | ");
      const summary = `Sincronización completada: ${results.success} exitosos, ${results.failed} fallidos, ${results.skipped} omitidos.`;
      return json({ success: detailLines ? `${summary} Detalle: ${detailLines}` : summary });
    } catch (err) {
      return json({ error: `Error en sincronización: ${err.message}` }, { status: 500 });
    }
  }

  if (intent === "update-mapping") {
    const id = formData.get("id");
    const erpCustomerCode = formData.get("erpCustomerCode")?.toString().trim();
    const syncEnabled = formData.get("syncEnabled") === "true";

    if (!id) return json({ error: "ID requerido" }, { status: 400 });

    const mapping = await db.customerMapping.findUnique({ where: { id } });
    if (!mapping) return json({ error: "Mapeo no encontrado" }, { status: 404 });

    // Build catalog data to save in DB
    const catalogData = {};
    const catalogKeys = [
      "tipoDocumentoId", "tipoPersonaId", "customerTypeId",
      "actividadEconomicaId", "taxpayerTypeId",
      "departamentoId", "municipioId", "distritoId",
    ];
    for (const key of catalogKeys) {
      const val = formData.get(key);
      if (val !== null) catalogData[key] = val || null;
    }

    await db.customerMapping.update({
      where: { id },
      data: { erpCustomerCode, syncEnabled, ...catalogData },
    });

    // Save only text-type metafields (DUI) to Shopify to avoid type conflicts
    if (erpCustomerCode) {
      try {
        const { setMetafields } = await import("../services/shopify-customers.server.js");
        await setMetafields(admin.graphql, mapping.shopifyCustomerId, [
          { namespace: "custom", key: "customer_dui", value: String(erpCustomerCode), type: "single_line_text_field" },
        ]);
      } catch (err) {
        console.error("[UpdateMapping] Failed to save DUI metafield:", err.message);
        return json({ success: "Mapeo actualizado, pero error al guardar metafield DUI: " + err.message });
      }
    }

    return json({ success: "Mapeo y catálogos actualizados" });
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

  if (intent === "setup-metafields") {
    try {
      const results = await createCustomerMetafieldDefinitions(admin.graphql);
      const msg = `Metafields configurados: ${results.created} creados, ${results.skipped} ya existían.`;
      if (results.errors.length > 0) {
        return json({ success: `${msg} Errores: ${results.errors.join(" | ")}` });
      }
      return json({ success: msg });
    } catch (err) {
      return json({ error: `Error al configurar metafields: ${err.message}` }, { status: 500 });
    }
  }

  return json({ error: "Acción no válida" }, { status: 400 });
};

export default function Customers() {
  const { mappings, total, page, pageSize, stats, customFieldMappings, customFieldValues, catalogs } = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();
  const [searchParams, setSearchParams] = useSearchParams();

  const [editModal, setEditModal] = useState(null);
  const [editCode, setEditCode] = useState("");
  const [editSync, setEditSync] = useState(true);
  const [editCatalog, setEditCatalog] = useState({});

  const totalPages = Math.ceil(total / pageSize);
  const isImporting = fetcher.state !== "idle";

  // Build select options from catalogs
  const toOptions = (items, labelKey = "name") =>
    [{ label: "— Seleccionar —", value: "" }].concat(
      (items || []).map((i) => ({ label: `${i[labelKey]}`, value: String(i.id) }))
    );

  const departamentoOpts = toOptions(catalogs?.departamentos);
  const tipoDocumentoOpts = toOptions(catalogs?.tiposDocumento);
  const tipoPersonaOpts = toOptions(catalogs?.tiposPersona);
  const tipoClienteOpts = toOptions(catalogs?.tiposCliente);
  const actividadOpts = toOptions(catalogs?.actividadesEconomicas);
  const tipoContribuyenteOpts = toOptions(catalogs?.tiposContribuyente);

  // Filtered municipios/distritos based on selection
  const municipioOpts = toOptions(
    (catalogs?.municipios || []).filter(
      (m) => !editCatalog.departamentoId || m.departamentoId === Number(editCatalog.departamentoId)
    )
  );
  const distritoOpts = toOptions(
    (catalogs?.distritos || []).filter(
      (d) => !editCatalog.municipioId || d.municipioId === Number(editCatalog.municipioId)
    )
  );

  const openEdit = (mapping) => {
    setEditModal(mapping);
    setEditCode(mapping.erpCustomerCode || "");
    setEditSync(mapping.syncEnabled);
    setEditCatalog({
      tipoDocumentoId: mapping.tipoDocumentoId || "",
      tipoPersonaId: mapping.tipoPersonaId || "",
      customerTypeId: mapping.customerTypeId || "",
      actividadEconomicaId: mapping.actividadEconomicaId || "",
      taxpayerTypeId: mapping.taxpayerTypeId || "",
      departamentoId: mapping.departamentoId || "",
      municipioId: mapping.municipioId || "",
      distritoId: mapping.distritoId || "",
    });
  };

  const closeEdit = () => setEditModal(null);

  const saveEdit = () => {
    const data = {
      intent: "update-mapping",
      id: editModal.id,
      erpCustomerCode: editCode,
      syncEnabled: String(editSync),
      // Always send catalog fields so they can be saved/cleared in DB
      tipoDocumentoId: editCatalog.tipoDocumentoId || "",
      tipoPersonaId: editCatalog.tipoPersonaId || "",
      customerTypeId: editCatalog.customerTypeId || "",
      actividadEconomicaId: editCatalog.actividadEconomicaId || "",
      taxpayerTypeId: editCatalog.taxpayerTypeId || "",
      departamentoId: editCatalog.departamentoId || "",
      municipioId: editCatalog.municipioId || "",
      distritoId: editCatalog.distritoId || "",
    };

    fetcher.submit(data, { method: "POST" });
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
        {
          content: "Configurar Campos MH",
          onAction: () => {
            fetcher.submit({ intent: "setup-metafields" }, { method: "POST" });
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
                label="Código del ERP (DUI/NIT)"
                value={editCode}
                onChange={setEditCode}
                autoComplete="off"
                helpText="Código de cliente tal como aparece en tu ERP (ej: 12345678-9)"
              />
              <Checkbox
                label="Sincronización activa"
                checked={editSync}
                onChange={setEditSync}
                helpText="Activa para incluir este cliente en la sincronización automática"
              />
              {catalogs && (
                <>
                  <Text variant="headingMd" as="h3">Catálogos MH</Text>
                  <Select
                    label="Tipo de Documento"
                    options={tipoDocumentoOpts}
                    value={editCatalog.tipoDocumentoId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, tipoDocumentoId: v })}
                  />
                  <Select
                    label="Tipo de Persona"
                    options={tipoPersonaOpts}
                    value={editCatalog.tipoPersonaId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, tipoPersonaId: v })}
                  />
                  <Select
                    label="Tipo de Cliente"
                    options={tipoClienteOpts}
                    value={editCatalog.customerTypeId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, customerTypeId: v })}
                  />
                  <Select
                    label="Actividad Económica"
                    options={actividadOpts}
                    value={editCatalog.actividadEconomicaId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, actividadEconomicaId: v })}
                  />
                  <Select
                    label="Tipo de Contribuyente"
                    options={tipoContribuyenteOpts}
                    value={editCatalog.taxpayerTypeId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, taxpayerTypeId: v })}
                  />
                  <Select
                    label="Departamento"
                    options={departamentoOpts}
                    value={editCatalog.departamentoId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, departamentoId: v, municipioId: "", distritoId: "" })}
                  />
                  <Select
                    label="Municipio"
                    options={municipioOpts}
                    value={editCatalog.municipioId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, municipioId: v, distritoId: "" })}
                    disabled={!editCatalog.departamentoId}
                  />
                  <Select
                    label="Distrito"
                    options={distritoOpts}
                    value={editCatalog.distritoId || ""}
                    onChange={(v) => setEditCatalog({ ...editCatalog, distritoId: v })}
                    disabled={!editCatalog.municipioId}
                  />
                </>
              )}
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
