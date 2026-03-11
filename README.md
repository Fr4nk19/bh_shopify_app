# BH Shopify App — ERP Inventory Sync

App de Shopify para sincronizar inventario en tiempo real entre Shopify y tu ERP (C# REST API).

## Características

- **Shopify → ERP**: Webhooks en tiempo real cuando cambia el stock en Shopify
- **ERP → Shopify**: Endpoint REST para que tu ERP envíe cambios de inventario
- **Sync automático**: Cron job configurable para pull periódico del ERP
- **Mapeo de productos**: Vincula variantes de Shopify con SKUs del ERP
- **Historial completo**: Log detallado de todas las sincronizaciones
- **Reintentos automáticos**: Cola con backoff exponencial para fallos
- **Panel admin**: UI embebida en Shopify Admin con Polaris

## Arquitectura

```
Shopify → webhook → App → PUT /api/inventory/{sku} → ERP (C#)
ERP (C#) → POST /api/erp-webhook → App → inventorySetQuantities → Shopify
App cron → GET /api/inventory → ERP → inventorySetQuantities → Shopify
```

## Requisitos

- Node.js >= 18.20.0
- PostgreSQL
- Cuenta de Shopify Partners
- ERP con API REST JSON

## Configuración

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Configurar base de datos
npx prisma migrate dev --name init

# 4. Iniciar en desarrollo
npm run dev
```

## Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `SHOPIFY_API_KEY` | API Key de tu app en Shopify Partners |
| `SHOPIFY_API_SECRET` | API Secret de tu app |
| `DATABASE_URL` | URL de PostgreSQL |
| `WEBHOOK_SECRET` | Secret para autenticar llamadas del ERP |

## Endpoints del ERP Esperados

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/inventory` | Listar todo el inventario |
| GET | `/api/inventory/{sku}` | Obtener stock de un SKU |
| PUT | `/api/inventory/{sku}` | Actualizar stock de un SKU |
| GET | `/api/products` | Listar productos (opcional) |

### Payload PUT /api/inventory/{sku}
```json
{
  "sku": "PROD-001",
  "quantity": 50,
  "source": "shopify",
  "updatedAt": "2024-01-01T00:00:00Z",
  "shopifyVariantId": "gid://shopify/ProductVariant/123"
}
```

## Endpoint para el ERP (push ERP → Shopify)

```
POST /api/erp-webhook
Headers:
  X-Webhook-Secret: <tu_webhook_secret>
  X-Shop-Domain: <tu-tienda.myshopify.com>
Body:
  { "sku": "PROD-001", "quantity": 50 }
  // o en lote:
  { "items": [{ "sku": "PROD-001", "quantity": 50 }] }
```

## Despliegue

```bash
# Build
npm run build

# Deploy a Shopify
npm run deploy

# Migraciones en producción
npx prisma migrate deploy
```

## Estructura del Proyecto

```
app/
├── routes/
│   ├── app._index.jsx              # Dashboard
│   ├── app.settings.jsx            # Config ERP
│   ├── app.sync-log.jsx            # Historial
│   ├── app.products.jsx            # Mapeo productos
│   ├── api.erp-webhook.jsx         # ERP → Shopify push endpoint
│   ├── webhooks.inventory-levels-update.jsx
│   ├── webhooks.products-create.jsx
│   ├── webhooks.products-update.jsx
│   └── webhooks.app-uninstalled.jsx
├── services/
│   ├── erp.server.js               # Cliente ERP (C#)
│   ├── shopify-inventory.server.js # GraphQL Shopify
│   └── sync.server.js              # Orquestador sync
├── shopify.server.js               # Config Shopify app
├── db.server.js                    # Prisma client
└── cron.server.js                  # Cron job sync
prisma/
└── schema.prisma                   # Modelos DB
```
