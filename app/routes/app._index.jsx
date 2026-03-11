/**
 * Dashboard Page
 * Shows sync stats, recent activity, and quick actions
 */

import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  DataTable,
  Banner,
  Box,
  Divider,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { getSyncStats } from "../services/sync.server.js";
import { db } from "../db.server.js";
import { fullSyncErpToShopify } from "../services/sync.server.js";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const [stats, recentLogs, settings] = await Promise.all([
    getSyncStats(shop),
    db.syncLog.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.shopSettings.findUnique({ where: { shop } }),
  ]);

  return json({ stats, recentLogs, settings, shop });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "full-sync") {
    try {
      const results = await fullSyncErpToShopify({
        shop,
        graphql: admin.graphql,
        source: "manual",
      });
      return json({ success: true, results });
    } catch (err) {
      return json({ success: false, error: err.message }, { status: 500 });
    }
  }

  return json({ error: "Unknown intent" }, { status: 400 });
};

export default function Dashboard() {
  const { stats, recentLogs, settings } = useLoaderData();
  const fetcher = useFetcher();

  const isSyncing = fetcher.state !== "idle";
  const syncResult = fetcher.data;

  const formatDate = (date) => {
    if (!date) return "—";
    return format(new Date(date), "dd MMM yyyy, HH:mm", { locale: es });
  };

  const statusBadge = (status) => {
    const map = {
      SUCCESS: <Badge tone="success">Exitoso</Badge>,
      FAILED: <Badge tone="critical">Fallido</Badge>,
      SKIPPED: <Badge tone="warning">Omitido</Badge>,
    };
    return map[status] || <Badge>{status}</Badge>;
  };

  const directionLabel = (dir) =>
    dir === "SHOPIFY_TO_ERP" ? "Shopify → ERP" : "ERP → Shopify";

  const tableRows = recentLogs.map((log) => [
    formatDate(log.createdAt),
    directionLabel(log.direction),
    log.erpSku || "—",
    log.quantityBefore !== null ? String(log.quantityBefore) : "—",
    log.quantityAfter !== null ? String(log.quantityAfter) : "—",
    statusBadge(log.status),
    log.source,
  ]);

  return (
    <Page
      title="Dashboard - ERP Sync"
      subtitle="Sincronización de inventario entre Shopify y tu ERP"
      primaryAction={{
        content: isSyncing ? "Sincronizando..." : "Sincronizar Todo",
        loading: isSyncing,
        disabled: !settings || isSyncing,
        onAction: () => {
          fetcher.submit({ intent: "full-sync" }, { method: "POST" });
        },
      }}
    >
      <BlockStack gap="500">
        {!settings && (
          <Banner
            title="Configura tu ERP primero"
            tone="warning"
            action={{ content: "Ir a Configuración", url: "/app/settings" }}
          >
            <p>
              Para empezar a sincronizar, configura la URL y API Key de tu ERP en
              la sección de Configuración.
            </p>
          </Banner>
        )}

        {syncResult && (
          <Banner
            title={syncResult.success ? "Sincronización completada" : "Error en sincronización"}
            tone={syncResult.success ? "success" : "critical"}
            onDismiss={() => {}}
          >
            {syncResult.success && (
              <p>
                Exitosos: {syncResult.results?.success} | Fallidos:{" "}
                {syncResult.results?.failed} | Omitidos:{" "}
                {syncResult.results?.skipped}
              </p>
            )}
            {!syncResult.success && <p>{syncResult.error}</p>}
          </Banner>
        )}

        {/* Stats Row */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Total Sincronizaciones</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold">
                  {stats.total}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Exitosas</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold" tone="success">
                  {stats.success}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h3">Fallidas</Text>
                <Text variant="heading2xl" as="p" fontWeight="bold" tone="critical">
                  {stats.failed}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Status Card */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">Estado del Sistema</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text>Sincronización automática</Text>
                  {settings?.syncEnabled ? (
                    <Badge tone="success">Activa</Badge>
                  ) : (
                    <Badge tone="critical">Inactiva</Badge>
                  )}
                </InlineStack>
                <InlineStack align="space-between">
                  <Text>Última sincronización</Text>
                  <Text>{formatDate(stats.lastSyncAt)}</Text>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text>Cola pendiente</Text>
                  <Badge tone={stats.pending > 0 ? "warning" : "success"}>
                    {stats.pending} pendientes
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text>Intervalo de sync</Text>
                  <Text>{settings?.syncIntervalMin || "—"} minutos</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">Acciones Rápidas</Text>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/products" variant="secondary">
                    Gestionar Mapeo de Productos
                  </Button>
                  <Button url="/app/sync-log" variant="secondary">
                    Ver Historial Completo
                  </Button>
                  <Button url="/app/settings" variant="secondary">
                    Configurar ERP
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Recent Logs */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <Text variant="headingMd" as="h3">Actividad Reciente</Text>
              <Button url="/app/sync-log" variant="plain">Ver todo</Button>
            </InlineStack>
            {recentLogs.length === 0 ? (
              <Box padding="400">
                <EmptyState
                  heading="Sin actividad aún"
                  image=""
                >
                  <p>Las sincronizaciones aparecerán aquí una vez que configures tu ERP.</p>
                </EmptyState>
              </Box>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "numeric", "numeric", "text", "text"]}
                headings={["Fecha", "Dirección", "SKU ERP", "Antes", "Después", "Estado", "Origen"]}
                rows={tableRows}
                truncate
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
