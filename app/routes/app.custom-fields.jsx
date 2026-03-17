/**
 * Custom Field Mapping Page
 * Configure which metafields sync between Shopify and ERP
 * for both products and customers
 */

import { json } from "@remix-run/node";
import {
  useLoaderData,
  useActionData,
  useFetcher,
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
  Select,
  EmptyState,
  Checkbox,
  Tabs,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [productFields, customerFields] = await Promise.all([
    db.customFieldMapping.findMany({
      where: { shop, resourceType: "PRODUCT" },
      orderBy: { shopifyField: "asc" },
    }),
    db.customFieldMapping.findMany({
      where: { shop, resourceType: "CUSTOMER" },
      orderBy: { shopifyField: "asc" },
    }),
  ]);

  return json({ productFields, customerFields, shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create-mapping") {
    const resourceType = formData.get("resourceType");
    const shopifyField = formData.get("shopifyField")?.toString().trim();
    const erpField = formData.get("erpField")?.toString().trim();
    const syncDirection = formData.get("syncDirection") || "ERP_TO_SHOPIFY";

    if (!shopifyField || !erpField) {
      return json({ error: "Ambos campos son requeridos" }, { status: 400 });
    }

    if (!shopifyField.includes(".")) {
      return json(
        { error: "El campo de Shopify debe tener formato namespace.key (ej: custom.color)" },
        { status: 400 }
      );
    }

    try {
      await db.customFieldMapping.create({
        data: {
          shop,
          resourceType,
          shopifyField,
          erpField,
          syncDirection,
          syncEnabled: true,
        },
      });
      return json({ success: "Mapeo de campo creado" });
    } catch (err) {
      if (err.code === "P2002") {
        return json({ error: "Este campo de Shopify ya está mapeado" }, { status: 400 });
      }
      return json({ error: `Error: ${err.message}` }, { status: 500 });
    }
  }

  if (intent === "delete-mapping") {
    const id = formData.get("id");
    await db.customFieldMapping.delete({ where: { id } });
    return json({ success: "Mapeo eliminado" });
  }

  if (intent === "toggle-sync") {
    const id = formData.get("id");
    const current = await db.customFieldMapping.findUnique({ where: { id } });
    await db.customFieldMapping.update({
      where: { id },
      data: { syncEnabled: !current.syncEnabled },
    });
    return json({ success: "Estado actualizado" });
  }

  return json({ error: "Acción no válida" }, { status: 400 });
};

export default function CustomFields() {
  const { productFields, customerFields } = useLoaderData();
  const actionData = useActionData();
  const fetcher = useFetcher();

  const [selectedTab, setSelectedTab] = useState(0);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newShopifyField, setNewShopifyField] = useState("");
  const [newErpField, setNewErpField] = useState("");
  const [newDirection, setNewDirection] = useState("ERP_TO_SHOPIFY");

  const tabs = [
    { id: "products", content: `Productos (${productFields.length})` },
    { id: "customers", content: `Clientes (${customerFields.length})` },
  ];

  const resourceType = selectedTab === 0 ? "PRODUCT" : "CUSTOMER";
  const fields = selectedTab === 0 ? productFields : customerFields;

  const directionLabel = (dir) =>
    dir === "ERP_TO_SHOPIFY" ? "ERP → Shopify" : "Shopify → ERP";

  const openCreate = () => {
    setNewShopifyField("");
    setNewErpField("");
    setNewDirection("ERP_TO_SHOPIFY");
    setShowCreateModal(true);
  };

  const saveCreate = () => {
    fetcher.submit(
      {
        intent: "create-mapping",
        resourceType,
        shopifyField: newShopifyField,
        erpField: newErpField,
        syncDirection: newDirection,
      },
      { method: "POST" }
    );
    setShowCreateModal(false);
  };

  const rows = fields.map((f) => [
    <Text fontWeight="semibold">{f.shopifyField}</Text>,
    f.erpField,
    directionLabel(f.syncDirection),
    f.syncEnabled ? (
      <Badge tone="success">Activo</Badge>
    ) : (
      <Badge tone="subdued">Inactivo</Badge>
    ),
    <InlineStack gap="200">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="toggle-sync" />
        <input type="hidden" name="id" value={f.id} />
        <Button size="slim" submit variant="plain">
          {f.syncEnabled ? "Pausar" : "Activar"}
        </Button>
      </fetcher.Form>
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="delete-mapping" />
        <input type="hidden" name="id" value={f.id} />
        <Button size="slim" submit variant="plain" tone="critical">
          Eliminar
        </Button>
      </fetcher.Form>
    </InlineStack>,
  ]);

  return (
    <Page
      title="Campos Personalizados"
      subtitle="Configura qué metafields se sincronizan entre Shopify y el ERP"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Agregar Campo",
        onAction: openCreate,
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
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <BlockStack gap="300">
              {fields.length === 0 ? (
                <EmptyState
                  heading={`Sin campos personalizados para ${resourceType === "PRODUCT" ? "productos" : "clientes"}`}
                  image=""
                  action={{
                    content: "Agregar Campo",
                    onAction: openCreate,
                  }}
                >
                  <p>
                    Configura campos personalizados para sincronizar metafields de
                    Shopify con campos del ERP.
                  </p>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={[
                    "Campo Shopify (namespace.key)",
                    "Campo ERP",
                    "Dirección",
                    "Estado",
                    "Acciones",
                  ]}
                  rows={rows}
                  truncate
                />
              )}
            </BlockStack>
          </Tabs>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h3">Guía de Campos Personalizados</Text>
            <Text>
              Los campos de Shopify usan el formato <strong>namespace.key</strong> (ej: <code>custom.rfc</code>, <code>custom.credit_limit</code>).
            </Text>
            <Text>
              Los campos del ERP corresponden al nombre del campo en tu sistema ERP (ej: <code>rfc</code>, <code>credit_limit</code>).
            </Text>
            <Text>
              <strong>Dirección:</strong> "ERP → Shopify" sincroniza del ERP hacia Shopify. "Shopify → ERP" sincroniza de Shopify hacia el ERP.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Create Modal */}
      {showCreateModal && (
        <Modal
          open
          onClose={() => setShowCreateModal(false)}
          title={`Nuevo campo - ${resourceType === "PRODUCT" ? "Producto" : "Cliente"}`}
          primaryAction={{ content: "Crear", onAction: saveCreate }}
          secondaryActions={[{ content: "Cancelar", onAction: () => setShowCreateModal(false) }]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="Campo de Shopify (namespace.key)"
                value={newShopifyField}
                onChange={setNewShopifyField}
                autoComplete="off"
                placeholder="custom.rfc"
                helpText="Formato: namespace.key — Ejemplo: custom.rfc, custom.credit_limit"
              />
              <TextField
                label="Campo del ERP"
                value={newErpField}
                onChange={setNewErpField}
                autoComplete="off"
                placeholder="rfc"
                helpText="Nombre exacto del campo como aparece en tu ERP"
              />
              <Select
                label="Dirección de sincronización"
                options={[
                  { label: "ERP → Shopify", value: "ERP_TO_SHOPIFY" },
                  { label: "Shopify → ERP", value: "SHOPIFY_TO_ERP" },
                ]}
                value={newDirection}
                onChange={setNewDirection}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
