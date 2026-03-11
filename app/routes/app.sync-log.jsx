/**
 * Sync Log Page
 * View all sync history with filtering
 */

import { json } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  BlockStack,
  InlineStack,
  Select,
  Button,
  Text,
  Pagination,
  EmptyState,
  Filters,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server.js";
import { db } from "../db.server.js";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const PAGE_SIZE = 25;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const direction = url.searchParams.get("direction") || "";
  const status = url.searchParams.get("status") || "";
  const sku = url.searchParams.get("sku") || "";

  const where = {
    shop,
    ...(direction ? { direction } : {}),
    ...(status ? { status } : {}),
    ...(sku ? { erpSku: { contains: sku, mode: "insensitive" } } : {}),
  };

  const [total, logs] = await Promise.all([
    db.syncLog.count({ where }),
    db.syncLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  return json({ logs, total, page, pageSize: PAGE_SIZE });
};

export default function SyncLog() {
  const { logs, total, page, pageSize } = useLoaderData();
  const [searchParams, setSearchParams] = useSearchParams();

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (date) =>
    format(new Date(date), "dd/MM/yyyy HH:mm:ss", { locale: es });

  const statusBadge = (status) => {
    const map = {
      SUCCESS: <Badge tone="success">Exitoso</Badge>,
      FAILED: <Badge tone="critical">Fallido</Badge>,
      SKIPPED: <Badge tone="warning">Omitido</Badge>,
    };
    return map[status] || <Badge>{status}</Badge>;
  };

  const directionBadge = (dir) => {
    if (dir === "SHOPIFY_TO_ERP") {
      return <Badge tone="info">Shopify → ERP</Badge>;
    }
    return <Badge tone="attention">ERP → Shopify</Badge>;
  };

  const rows = logs.map((log) => [
    formatDate(log.createdAt),
    directionBadge(log.direction),
    log.erpSku || "—",
    log.shopifyVariantId?.split("/").pop() || "—",
    log.quantityBefore !== null ? String(log.quantityBefore) : "—",
    log.quantityAfter !== null ? String(log.quantityAfter) : "—",
    statusBadge(log.status),
    log.source,
    log.errorMessage ? (
      <Text tone="critical" variant="bodySm" truncate>
        {log.errorMessage}
      </Text>
    ) : "—",
  ]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <Page
      title="Historial de Sincronización"
      subtitle={`${total} registros totales`}
      backAction={{ content: "Dashboard", url: "/app" }}
    >
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="300" wrap>
              <Select
                label="Dirección"
                labelInline
                options={[
                  { label: "Todas", value: "" },
                  { label: "Shopify → ERP", value: "SHOPIFY_TO_ERP" },
                  { label: "ERP → Shopify", value: "ERP_TO_SHOPIFY" },
                ]}
                value={searchParams.get("direction") || ""}
                onChange={(v) => updateFilter("direction", v)}
              />
              <Select
                label="Estado"
                labelInline
                options={[
                  { label: "Todos", value: "" },
                  { label: "Exitoso", value: "SUCCESS" },
                  { label: "Fallido", value: "FAILED" },
                  { label: "Omitido", value: "SKIPPED" },
                ]}
                value={searchParams.get("status") || ""}
                onChange={(v) => updateFilter("status", v)}
              />
              <Form method="get">
                <InlineStack gap="200" blockAlign="end">
                  <input
                    name="sku"
                    placeholder="Filtrar por SKU..."
                    defaultValue={searchParams.get("sku") || ""}
                    style={{
                      padding: "6px 12px",
                      border: "1px solid #c9cccf",
                      borderRadius: 4,
                      fontSize: 14,
                    }}
                  />
                  <input type="hidden" name="direction" value={searchParams.get("direction") || ""} />
                  <input type="hidden" name="status" value={searchParams.get("status") || ""} />
                  <Button submit variant="secondary">Buscar</Button>
                </InlineStack>
              </Form>
            </InlineStack>
          </BlockStack>
        </Card>

        <Card>
          {logs.length === 0 ? (
            <EmptyState heading="Sin registros" image="">
              <p>No hay registros de sincronización para los filtros seleccionados.</p>
            </EmptyState>
          ) : (
            <BlockStack gap="300">
              <DataTable
                columnContentTypes={[
                  "text", "text", "text", "text",
                  "numeric", "numeric", "text", "text", "text",
                ]}
                headings={[
                  "Fecha", "Dirección", "SKU ERP", "Variant ID",
                  "Antes", "Después", "Estado", "Origen", "Error",
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
            </BlockStack>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
