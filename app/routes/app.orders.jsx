/**
 * Orders Page
 * Lists recent Shopify orders and allows sending them to the ERP as invoices
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
  EmptyState,
  Spinner,
  Modal,
  TextField,
  Select,
  FormLayout,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "../shopify.server.js";
import { createErpSale } from "../services/erp.server.js";
import { db } from "../db.server.js";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const ORDERS_QUERY = `#graphql
  query GetOrders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        cursor
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            id
            firstName
            lastName
            email
          }
          lineItems(first: 50) {
            edges {
              node {
                sku
                name
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
                discountedTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
          billingAddress {
            address1
            address2
            city
            province
            country
          }
          shippingAddress {
            address1
            address2
            city
            province
            country
          }
          note
          paymentGatewayNames
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const after = url.searchParams.get("after") || null;

  let orders = [];
  let pageInfo = { hasNextPage: false, endCursor: null };

  try {
    const response = await admin.graphql(ORDERS_QUERY, {
      variables: { first: 25, after },
    });
    const responseJson = await response.json();
    const data = responseJson.data;

    if (data?.orders) {
      orders = data.orders.edges.map((e) => e.node);
      pageInfo = data.orders.pageInfo;
    }
  } catch (err) {
    console.error("Error fetching orders from Shopify:", err);
  }

  const settings = await db.shopSettings.findUnique({ where: { shop } });

  // Check which orders have already been synced to ERP
  const syncedMap = {};
  if (orders.length > 0) {
    const orderIds = orders.map((o) => `ORDER:${o.id}`);
    const syncedOrders = await db.syncLog.findMany({
      where: {
        shop,
        erpSku: { in: orderIds },
        status: "SUCCESS",
      },
      select: { erpSku: true, payload: true, createdAt: true },
    });

    for (const log of syncedOrders) {
      syncedMap[log.erpSku] = {
        syncedAt: log.createdAt,
        payload: log.payload,
      };
    }
  }

  return json({
    orders,
    pageInfo,
    settings,
    syncedMap,
    shop,
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "create-invoice") {
    const settings = await db.shopSettings.findUnique({ where: { shop } });
    if (!settings) {
      return json(
        { success: false, error: "No hay configuración ERP para esta tienda." },
        { status: 400 }
      );
    }

    const orderId = formData.get("orderId");
    const orderName = formData.get("orderName");
    const customerEmail = formData.get("customerEmail");
    const customerCode = formData.get("customerCode") || null;
    const invoiceTypeId = parseInt(formData.get("invoiceTypeId") || "1", 10);
    const paymentTermId = parseInt(formData.get("paymentTermId") || "1", 10);
    const billingAddress = formData.get("billingAddress") || null;
    const shippingAddress = formData.get("shippingAddress") || null;
    const notes = formData.get("notes") || null;
    const lineItemsRaw = formData.get("lineItems");
    const paymentsRaw = formData.get("payments");

    let lineItems = [];
    let payments = [];

    try {
      lineItems = JSON.parse(lineItemsRaw);
      payments = JSON.parse(paymentsRaw);
    } catch {
      return json(
        { success: false, error: "Error al parsear los datos de la orden." },
        { status: 400 }
      );
    }

    if (lineItems.length === 0) {
      return json(
        { success: false, error: "La orden no tiene items con SKU para enviar al ERP." },
        { status: 400 }
      );
    }

    const orderData = {
      shopifyOrderId: orderId,
      shopifyOrderNumber: orderName,
      customerEmail,
      customerCode,
      companyBranchId: parseInt(settings.erpBranchId, 10),
      invoiceTypeId,
      paymentTermId,
      catMhActividadesId: parseInt(settings.erpCompanyId, 10),
      billingAddress,
      shippingAddress,
      notes,
      lineItems,
      payments,
    };

    try {
      const result = await createErpSale(shop, orderData);

      // Log success
      await db.syncLog.create({
        data: {
          shop,
          direction: "SHOPIFY_TO_ERP",
          status: "SUCCESS",
          source: "manual",
          erpSku: `ORDER:${orderId}`,
          payload: JSON.stringify({
            shopifyOrderNumber: orderName,
            erpSaleId: result.saleId,
            correlativeNumber: result.correlativeNumber,
            total: result.total,
            skippedItems: result.skippedItems?.length || 0,
          }),
        },
      });

      return json({
        success: true,
        orderId,
        saleId: result.saleId,
        correlativeNumber: result.correlativeNumber,
        total: result.total,
        skippedItems: result.skippedItems || [],
      });
    } catch (err) {
      // Log failure
      await db.syncLog.create({
        data: {
          shop,
          direction: "SHOPIFY_TO_ERP",
          status: "FAILED",
          source: "manual",
          erpSku: `ORDER:${orderId}`,
          errorMessage: err.message,
          payload: JSON.stringify({ shopifyOrderNumber: orderName }),
        },
      });

      return json(
        { success: false, orderId, error: err.message },
        { status: 500 }
      );
    }
  }

  return json({ error: "Acción desconocida" }, { status: 400 });
};

// ─── Payment Mapping ────────────────────────────────────────────────────────

function mapPaymentGateway(gateway) {
  const g = (gateway || "").toLowerCase();
  if (g.includes("cash") || g === "manual") return { id: 1, label: "Efectivo" };
  if (g.includes("debit")) return { id: 2, label: "Débito" };
  if (g.includes("credit") || g.includes("card") || g.includes("shopify_payments") || g.includes("stripe"))
    return { id: 3, label: "Crédito" };
  if (g.includes("transfer") || g.includes("bank")) return { id: 5, label: "Transferencia" };
  if (g.includes("paypal") || g.includes("digital")) return { id: 8, label: "Dinero electrónico" };
  if (g.includes("bitcoin") || g.includes("crypto")) return { id: 11, label: "Bitcoin" };
  return { id: 99, label: "Otros" };
}

function buildAddressString(addr) {
  if (!addr) return "";
  return [addr.address1, addr.address2, addr.city, addr.province, addr.country]
    .filter(Boolean)
    .join(", ");
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const { orders, pageInfo, settings, syncedMap } = useLoaderData();
  const fetcher = useFetcher();

  const [selectedOrder, setSelectedOrder] = useState(null);
  const [invoiceTypeId, setInvoiceTypeId] = useState("1");
  const [paymentTermId, setPaymentTermId] = useState("1");
  const [customerCode, setCustomerCode] = useState("");

  const isSubmitting = fetcher.state !== "idle";
  const actionResult = fetcher.data;

  const formatDate = (date) => {
    if (!date) return "—";
    return format(new Date(date), "dd MMM yyyy, HH:mm", { locale: es });
  };

  const financialBadge = (status) => {
    const map = {
      PAID: <Badge tone="success">Pagada</Badge>,
      PENDING: <Badge tone="warning">Pendiente</Badge>,
      PARTIALLY_PAID: <Badge tone="attention">Pago parcial</Badge>,
      REFUNDED: <Badge tone="info">Reembolsada</Badge>,
      PARTIALLY_REFUNDED: <Badge tone="info">Reembolso parcial</Badge>,
      VOIDED: <Badge tone="critical">Anulada</Badge>,
      AUTHORIZED: <Badge tone="info">Autorizada</Badge>,
    };
    return map[status] || <Badge>{status}</Badge>;
  };

  const fulfillmentBadge = (status) => {
    const map = {
      FULFILLED: <Badge tone="success">Completada</Badge>,
      UNFULFILLED: <Badge tone="warning">Sin enviar</Badge>,
      PARTIALLY_FULFILLED: <Badge tone="attention">Parcial</Badge>,
      null: <Badge tone="warning">Sin enviar</Badge>,
    };
    return map[status] || <Badge>{status || "Sin enviar"}</Badge>;
  };

  const handleCreateInvoice = useCallback(
    (order) => {
      setSelectedOrder(order);
      setCustomerCode("");
      setInvoiceTypeId("1");
      setPaymentTermId("1");
    },
    []
  );

  const handleSubmitInvoice = useCallback(() => {
    if (!selectedOrder) return;

    const order = selectedOrder;
    const lineItems = order.lineItems.edges
      .filter((e) => e.node.sku && e.node.sku.trim() !== "")
      .map((e) => {
        const item = e.node;
        const originalPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount ?? "0");
        const discountedTotal = parseFloat(item.discountedTotalSet?.shopMoney?.amount ?? "0");
        const originalTotal = originalPrice * item.quantity;
        const discountPercent =
          originalTotal > 0 && discountedTotal < originalTotal
            ? Math.round(((originalTotal - discountedTotal) / originalTotal) * 100 * 100) / 100
            : 0;
        return {
          sku: item.sku,
          quantity: item.quantity,
          price: originalPrice,
          discountPercent,
        };
      });

    const totalPrice = parseFloat(order.totalPriceSet.shopMoney.amount);
    const gateways = order.paymentGatewayNames || [];
    const payments =
      gateways.length > 0
        ? gateways.map((gw) => ({
            paymentMethodId: mapPaymentGateway(gw).id,
            amount: Math.round((totalPrice / gateways.length) * 100) / 100,
            referenceNumber: order.name,
          }))
        : [{ paymentMethodId: 99, amount: totalPrice, referenceNumber: order.name }];

    const formData = new FormData();
    formData.set("intent", "create-invoice");
    formData.set("orderId", order.id);
    formData.set("orderName", order.name);
    formData.set("customerEmail", order.customer?.email || "");
    formData.set("customerCode", customerCode);
    formData.set("invoiceTypeId", invoiceTypeId);
    formData.set("paymentTermId", paymentTermId);
    formData.set("billingAddress", buildAddressString(order.billingAddress));
    formData.set("shippingAddress", buildAddressString(order.shippingAddress));
    formData.set("notes", order.note || "");
    formData.set("lineItems", JSON.stringify(lineItems));
    formData.set("payments", JSON.stringify(payments));

    fetcher.submit(formData, { method: "POST" });
    setSelectedOrder(null);
  }, [selectedOrder, customerCode, invoiceTypeId, paymentTermId, fetcher]);

  const invoiceTypeOptions = [
    { label: "Consumidor Final", value: "1" },
    { label: "Crédito Fiscal", value: "2" },
    { label: "Ticket", value: "4" },
  ];

  const paymentTermOptions = [
    { label: "Contado", value: "1" },
    { label: "Crédito 15 días", value: "2" },
    { label: "Crédito 30 días", value: "3" },
    { label: "Crédito 45 días", value: "4" },
    { label: "Crédito 60 días", value: "5" },
    { label: "Crédito 90 días", value: "6" },
  ];

  const skuCount = (order) =>
    order.lineItems.edges.filter((e) => e.node.sku && e.node.sku.trim() !== "").length;

  const tableRows = orders.map((order) => {
    const synced = syncedMap[`ORDER:${order.id}`];
    const total = parseFloat(order.totalPriceSet.shopMoney.amount);
    const currency = order.totalPriceSet.shopMoney.currencyCode;
    const customerName = order.customer
      ? `${order.customer.firstName || ""} ${order.customer.lastName || ""}`.trim()
      : "—";
    const skus = skuCount(order);

    return [
      order.name,
      formatDate(order.createdAt),
      customerName,
      `${currency} ${total.toFixed(2)}`,
      financialBadge(order.displayFinancialStatus),
      fulfillmentBadge(order.displayFulfillmentStatus),
      `${skus} items`,
      synced ? (
        <Badge tone="success">Facturada</Badge>
      ) : skus > 0 ? (
        <Button
          size="slim"
          variant="primary"
          onClick={() => handleCreateInvoice(order)}
          disabled={isSubmitting}
        >
          Crear Factura
        </Button>
      ) : (
        <Badge tone="subdued">Sin SKU</Badge>
      ),
    ];
  });

  return (
    <Page
      title="Órdenes de Shopify"
      subtitle="Envía órdenes al ERP para generar facturas"
      backAction={{ url: "/app" }}
    >
      <BlockStack gap="500">
        {!settings && (
          <Banner
            title="Configura tu ERP primero"
            tone="warning"
            action={{ content: "Ir a Configuración", url: "/app/settings" }}
          >
            <p>Para crear facturas, configura la conexión al ERP en Configuración.</p>
          </Banner>
        )}

        {actionResult?.success && (
          <Banner
            title="Factura creada exitosamente"
            tone="success"
            onDismiss={() => {}}
          >
            <p>
              Orden {actionResult.orderId} → Factura #{actionResult.correlativeNumber} |
              Total: ${actionResult.total?.toFixed(2)}
              {actionResult.skippedItems?.length > 0 && (
                <> | {actionResult.skippedItems.length} items omitidos (sin match en ERP)</>
              )}
            </p>
          </Banner>
        )}

        {actionResult && !actionResult.success && actionResult.error && (
          <Banner
            title="Error al crear factura"
            tone="critical"
            onDismiss={() => {}}
          >
            <p>{actionResult.error}</p>
          </Banner>
        )}

        <Card>
          {orders.length === 0 ? (
            <Box padding="400">
              <EmptyState heading="Sin órdenes" image="">
                <p>No hay órdenes recientes en tu tienda Shopify.</p>
              </EmptyState>
            </Box>
          ) : (
            <BlockStack gap="300">
              <DataTable
                columnContentTypes={[
                  "text",
                  "text",
                  "text",
                  "numeric",
                  "text",
                  "text",
                  "text",
                  "text",
                ]}
                headings={[
                  "Orden",
                  "Fecha",
                  "Cliente",
                  "Total",
                  "Pago",
                  "Envío",
                  "SKUs",
                  "Acción",
                ]}
                rows={tableRows}
                truncate
              />
              {pageInfo.hasNextPage && (
                <Box padding="300">
                  <InlineStack align="center">
                    <Button
                      url={`/app/orders?after=${pageInfo.endCursor}`}
                      variant="plain"
                    >
                      Cargar más órdenes
                    </Button>
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          )}
        </Card>

        {isSubmitting && (
          <Card>
            <InlineStack align="center" gap="300">
              <Spinner size="small" />
              <Text>Enviando orden al ERP...</Text>
            </InlineStack>
          </Card>
        )}
      </BlockStack>

      {/* Modal for invoice options before sending */}
      {selectedOrder && (
        <Modal
          open={!!selectedOrder}
          onClose={() => setSelectedOrder(null)}
          title={`Crear Factura - ${selectedOrder.name}`}
          primaryAction={{
            content: "Crear Factura",
            onAction: handleSubmitInvoice,
          }}
          secondaryActions={[
            { content: "Cancelar", onAction: () => setSelectedOrder(null) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Banner tone="info">
                <p>
                  Se enviarán {skuCount(selectedOrder)} items con SKU al ERP.
                  Total: {selectedOrder.totalPriceSet.shopMoney.currencyCode}{" "}
                  {parseFloat(selectedOrder.totalPriceSet.shopMoney.amount).toFixed(2)}
                </p>
              </Banner>

              <FormLayout>
                <TextField
                  label="Código de cliente (DUI/NIT)"
                  value={customerCode}
                  onChange={setCustomerCode}
                  placeholder="Ej: 12345678-9"
                  helpText="Opcional. Si no se especifica, se buscará por email en el ERP."
                  autoComplete="off"
                />

                <Select
                  label="Tipo de factura"
                  options={invoiceTypeOptions}
                  value={invoiceTypeId}
                  onChange={setInvoiceTypeId}
                />

                <Select
                  label="Condición de pago"
                  options={paymentTermOptions}
                  value={paymentTermId}
                  onChange={setPaymentTermId}
                />

                {selectedOrder.paymentGatewayNames?.length > 0 && (
                  <TextField
                    label="Método de pago detectado"
                    value={selectedOrder.paymentGatewayNames
                      .map((gw) => `${gw} → ${mapPaymentGateway(gw).label}`)
                      .join(", ")}
                    disabled
                  />
                )}

                {selectedOrder.customer && (
                  <TextField
                    label="Cliente"
                    value={`${selectedOrder.customer.firstName || ""} ${selectedOrder.customer.lastName || ""} (${selectedOrder.customer.email || "sin email"})`}
                    disabled
                  />
                )}
              </FormLayout>

              {/* Line items preview */}
              <Text variant="headingSm" as="h4">Items a facturar:</Text>
              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric"]}
                headings={["SKU", "Producto", "Cant.", "Precio"]}
                rows={selectedOrder.lineItems.edges
                  .filter((e) => e.node.sku && e.node.sku.trim() !== "")
                  .map((e) => [
                    e.node.sku,
                    e.node.name,
                    String(e.node.quantity),
                    `$${parseFloat(e.node.originalUnitPriceSet?.shopMoney?.amount ?? "0").toFixed(2)}`,
                  ])}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      )}
    </Page>
  );
}
