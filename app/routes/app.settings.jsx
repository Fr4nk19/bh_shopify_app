/**
 * Settings Page
 * Configure ERP connection per shop
 */

import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, Form, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Button,
  Banner,
  BlockStack,
  Select,
  Divider,
  Text,
  Badge,
  InlineStack,
  Checkbox,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";
import { testErpConnection } from "../services/erp.server.js";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await db.shopSettings.findUnique({ where: { shop } });
  return json({ settings, shop });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "test") {
    // Save temporarily and test
    const erpBaseUrl = formData.get("erpBaseUrl")?.toString().trim();
    const erpApiKey = formData.get("erpApiKey")?.toString().trim();
    const erpApiHeader = formData.get("erpApiHeader")?.toString().trim() || "X-Api-Key";
    const erpCompanyId = parseInt(formData.get("erpCompanyId") || "0", 10) || null;
    const erpBranchId = parseInt(formData.get("erpBranchId") || "0", 10) || null;

    if (!erpBaseUrl || !erpApiKey) {
      return json({ error: "URL y API Key son requeridos para probar la conexión" });
    }

    // Temporarily upsert to test
    await db.shopSettings.upsert({
      where: { shop },
      update: { erpBaseUrl, erpApiKey, erpApiHeader, erpCompanyId, erpBranchId },
      create: {
        shop,
        erpBaseUrl,
        erpApiKey,
        erpApiHeader,
        erpCompanyId,
        erpBranchId,
        syncEnabled: false,
      },
    });

    const result = await testErpConnection(shop);
    return json({ testResult: result });
  }

  if (intent === "save") {
    const erpBaseUrl = formData.get("erpBaseUrl")?.toString().trim();
    const erpApiKey = formData.get("erpApiKey")?.toString().trim();
    const erpApiHeader = formData.get("erpApiHeader")?.toString().trim() || "X-Api-Key";
    const erpCompanyId = parseInt(formData.get("erpCompanyId") || "0", 10) || null;
    const erpBranchId = parseInt(formData.get("erpBranchId") || "0", 10) || null;
    const syncEnabled = formData.get("syncEnabled") === "true";
    const syncIntervalMin = parseInt(formData.get("syncIntervalMin") || "15", 10);

    if (!erpBaseUrl || !erpApiKey) {
      return json({ error: "URL del ERP y API Key son requeridos" });
    }

    await db.shopSettings.upsert({
      where: { shop },
      update: {
        erpBaseUrl,
        erpApiKey,
        erpApiHeader,
        erpCompanyId,
        erpBranchId,
        syncEnabled,
        syncIntervalMin,
      },
      create: {
        shop,
        erpBaseUrl,
        erpApiKey,
        erpApiHeader,
        erpCompanyId,
        erpBranchId,
        syncEnabled,
        syncIntervalMin,
      },
    });

    return json({ success: "Configuración guardada correctamente" });
  }

  return json({ error: "Acción no válida" });
};

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSaving = navigation.state === "submitting";

  const [erpBaseUrl, setErpBaseUrl] = useState(settings?.erpBaseUrl || "");
  const [erpApiKey, setErpApiKey] = useState(settings?.erpApiKey || "");
  const [erpApiHeader, setErpApiHeader] = useState(
    settings?.erpApiHeader || "X-Api-Key"
  );
  const [erpCompanyId, setErpCompanyId] = useState(
    String(settings?.erpCompanyId || "")
  );
  const [erpBranchId, setErpBranchId] = useState(
    String(settings?.erpBranchId || "")
  );
  const [syncEnabled, setSyncEnabled] = useState(settings?.syncEnabled ?? true);
  const [syncIntervalMin, setSyncIntervalMin] = useState(
    String(settings?.syncIntervalMin || 15)
  );

  const intervalOptions = [
    { label: "5 minutos", value: "5" },
    { label: "15 minutos", value: "15" },
    { label: "30 minutos", value: "30" },
    { label: "60 minutos", value: "60" },
    { label: "120 minutos", value: "120" },
  ];

  return (
    <Page
      title="Configuración ERP"
      subtitle="Conecta tu ERP con Shopify para sincronizar el inventario"
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="500">
        {actionData?.error && (
          <Banner tone="critical" title="Error">
            <p>{actionData.error}</p>
          </Banner>
        )}
        {actionData?.success && (
          <Banner tone="success" title="Guardado">
            <p>{actionData.success}</p>
          </Banner>
        )}
        {actionData?.testResult && (
          <Banner
            tone={actionData.testResult.success ? "success" : "critical"}
            title={actionData.testResult.success ? "Conexión exitosa" : "Error de conexión"}
          >
            <p>{actionData.testResult.message}</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Conexión al ERP</Text>
                <Divider />
                <Form method="post">
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="syncEnabled" value={String(syncEnabled)} />
                  <FormLayout>
                    <TextField
                      label="URL Base del ERP"
                      name="erpBaseUrl"
                      value={erpBaseUrl}
                      onChange={setErpBaseUrl}
                      placeholder="https://tu-erp.com"
                      helpText="URL base de tu API REST en C#. Ej: https://erp.miempresa.com"
                      autoComplete="off"
                      requiredIndicator
                    />
                    <TextField
                      label="API Key"
                      name="erpApiKey"
                      value={erpApiKey}
                      onChange={setErpApiKey}
                      type="password"
                      helpText="Clave generada desde tu ERP (formato: shpk_...). Cada empresa genera su propia clave vinculada a su Company ID y Branch ID."
                      autoComplete="off"
                      requiredIndicator
                    />
                    <TextField
                      label="Header de Autenticación"
                      name="erpApiHeader"
                      value={erpApiHeader}
                      onChange={setErpApiHeader}
                      placeholder="X-Api-Key"
                      helpText="Nombre del header HTTP donde se envía la API Key. Por defecto: X-Api-Key. Usa 'Authorization' para Bearer tokens."
                      autoComplete="off"
                    />
                    <Divider />
                    <Text variant="headingMd" as="h3">Empresa y Sucursal</Text>
                    <TextField
                      label="Company ID (Empresa)"
                      name="erpCompanyId"
                      type="number"
                      value={erpCompanyId}
                      onChange={setErpCompanyId}
                      placeholder="1"
                      helpText="ID de la empresa en el ERP. Opcional si usas una API Key per-company (se resuelve automaticamente desde la clave)."
                      autoComplete="off"
                    />
                    <TextField
                      label="Branch ID (Sucursal)"
                      name="erpBranchId"
                      type="number"
                      value={erpBranchId}
                      onChange={setErpBranchId}
                      placeholder="1"
                      helpText="ID de la sucursal/bodega en el ERP. Opcional si usas una API Key per-company."
                      autoComplete="off"
                    />
                    <Divider />
                    <Text variant="headingMd" as="h3">Sincronización Automática</Text>
                    <Checkbox
                      label="Activar sincronización automática (cron)"
                      checked={syncEnabled}
                      onChange={setSyncEnabled}
                      helpText="Sincroniza el inventario del ERP a Shopify periódicamente"
                    />
                    <Select
                      label="Intervalo de sincronización"
                      name="syncIntervalMin"
                      options={intervalOptions}
                      value={syncIntervalMin}
                      onChange={setSyncIntervalMin}
                      disabled={!syncEnabled}
                    />
                    <InlineStack gap="300">
                      <Button
                        variant="primary"
                        submit
                        loading={isSaving && navigation.formData?.get("intent") === "save"}
                      >
                        Guardar Configuración
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h3">Probar Conexión</Text>
                  <Text tone="subdued">
                    Verifica que la URL y API Key sean correctas antes de guardar.
                  </Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="test" />
                    <input type="hidden" name="erpBaseUrl" value={erpBaseUrl} />
                    <input type="hidden" name="erpApiKey" value={erpApiKey} />
                    <input type="hidden" name="erpApiHeader" value={erpApiHeader} />
                    <input type="hidden" name="erpCompanyId" value={erpCompanyId} />
                    <input type="hidden" name="erpBranchId" value={erpBranchId} />
                    <Button
                      variant="secondary"
                      submit
                      loading={isSaving && navigation.formData?.get("intent") === "test"}
                      disabled={!erpBaseUrl || !erpApiKey}
                    >
                      Probar Conexión
                    </Button>
                  </Form>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h3">Endpoint para el ERP</Text>
                  <Text tone="subdued" variant="bodySm">
                    Configura tu ERP para enviar cambios de inventario a este endpoint:
                  </Text>
                  <Card background="bg-surface-secondary">
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      POST /api/erp-webhook
                    </Text>
                  </Card>
                  <Text variant="bodySm" tone="subdued">
                    Headers requeridos:
                  </Text>
                  <BlockStack gap="100">
                    <Text variant="bodySm">
                      • <strong>X-Webhook-Secret:</strong> {"{WEBHOOK_SECRET}"}
                    </Text>
                    <Text variant="bodySm">
                      • <strong>X-Shop-Domain:</strong> {"{tu-tienda.myshopify.com}"}
                    </Text>
                  </BlockStack>
                  <Text variant="bodySm" tone="subdued">
                    Body JSON:
                  </Text>
                  <pre style={{ fontSize: 11, background: "#f4f6f8", padding: 8, borderRadius: 4, overflow: "auto" }}>
{`{
  "sku": "PROD-001",
  "quantity": 50
}

// O en lote:
{
  "items": [
    { "sku": "PROD-001", "quantity": 50 },
    { "sku": "PROD-002", "quantity": 10 }
  ]
}`}
                  </pre>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
