# Guía de Despliegue — BH Shopify App (ERP Inventory Sync)

Guía paso a paso para deployar la app, configurarla y revisar los productos/campos que se sincronizan con el ERP.

---

## 1. Requisitos Previos

- **Node.js** >= 18.20.0
- **PostgreSQL** (instancia corriendo y accesible)
- **Cuenta Shopify Partners** con la app creada
- **Shopify CLI** instalado: `npm install -g @shopify/cli`
- **ERP con API REST** funcionando y accesible desde el servidor

---

## 2. Configurar Variables de Entorno

```bash
cp .env.example .env
```

Editar `.env` con tus valores reales:

```env
# Shopify (obtener desde Shopify Partners → tu app → API credentials)
SHOPIFY_API_KEY=tu_api_key
SHOPIFY_API_SECRET=tu_api_secret
SHOPIFY_APP_URL=https://tu-url-de-la-app.com

# Base de datos PostgreSQL
DATABASE_URL="postgresql://usuario:contraseña@host:5432/bh_shopify_app?schema=public"

# ERP (valores por defecto, se pueden sobreescribir por tienda en Settings)
ERP_BASE_URL=https://tu-erp-api.com
ERP_API_KEY=tu_api_key_del_erp
ERP_API_HEADER=X-Api-Key

# Sync
SYNC_INTERVAL_MINUTES=15
WEBHOOK_SECRET=un_secreto_seguro_para_validar_llamadas_del_erp
```

---

## 3. Despliegue Local (Desarrollo)

```bash
# Instalar dependencias
npm install

# Crear/migrar la base de datos
npx prisma migrate dev --name init

# Iniciar servidor de desarrollo (usa Shopify CLI)
npm run dev
```

Shopify CLI abrirá un túnel y te dará la URL de tu app. Instálala en tu tienda de desarrollo.

---

## 4. Despliegue en Railway

### 4.1 Crear el proyecto en Railway

1. Ve a [railway.app](https://railway.app) e inicia sesión
2. Click **"New Project"**
3. Selecciona **"Deploy from GitHub repo"** y conecta este repositorio
4. Railway detectará el `Dockerfile` automáticamente

### 4.2 Agregar PostgreSQL

1. Dentro del proyecto, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway creará la BD y la variable `DATABASE_URL` automáticamente
3. Ve a la BD → **"Variables"** → copia el valor de `DATABASE_URL`
4. Ve al servicio de la app → **"Variables"** → agrega `DATABASE_URL` con ese valor
   (o usa la referencia: `${{Postgres.DATABASE_URL}}`)

### 4.3 Configurar Variables de Entorno

En Railway → tu servicio → **"Variables"**, agrega todas estas:

| Variable | Valor | Notas |
|----------|-------|-------|
| `SHOPIFY_API_KEY` | `3db4d...` | Client ID de Shopify Partners |
| `SHOPIFY_API_SECRET` | `shpss_...` | Client Secret de Shopify Partners |
| `SHOPIFY_APP_URL` | `https://tu-app.up.railway.app` | URL pública que Railway te asigna |
| `SCOPES` | `read_inventory,write_inventory,read_products,write_products,read_locations` | Permisos de la app |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Referencia a la BD de Railway |
| `ERP_BASE_URL` | `https://tu-erp.com` | URL base de tu ERP |
| `ERP_API_KEY` | tu API key | Clave de autenticación del ERP |
| `ERP_API_HEADER` | `X-Api-Key` | Header HTTP para la API key |
| `SYNC_INTERVAL_MINUTES` | `15` | Intervalo del cron sync |
| `WEBHOOK_SECRET` | un secreto seguro | Para validar llamadas del ERP |
| `PORT` | `3000` | Puerto del servidor (Railway lo detecta) |
| `NODE_ENV` | `production` | Entorno de ejecución |

> **Para editar variables después:** Railway → tu proyecto → servicio → pestaña **"Variables"**. Cada cambio redeploya automáticamente.

### 4.4 Obtener la URL pública

1. Ve al servicio → **"Settings"** → **"Networking"**
2. Click **"Generate Domain"** para obtener una URL `*.up.railway.app`
3. Copia esa URL y actualiza la variable `SHOPIFY_APP_URL` con ella
4. También actualiza la URL en **Shopify Partners → tu app → Configuration → App URL**

### 4.5 Actualizar shopify.app.toml

En tu repo local, actualiza el `shopify.app.toml`:

```toml
application_url = "https://tu-app.up.railway.app"

[auth]
redirect_urls = [
  "https://tu-app.up.railway.app/auth/callback",
  "https://tu-app.up.railway.app/auth/shopify/callback",
  "https://tu-app.up.railway.app/api/auth/callback"
]
```

Luego despliega la configuración de la app a Shopify:

```bash
npm run deploy
```

### 4.6 Verificar el deploy

1. Abre la URL de Railway en el navegador
2. Ve a tu tienda Shopify → Apps → instala la app
3. Configura el ERP desde la UI de la app

### Despliegue manual alternativo (sin Docker)

```bash
# Build
npm run build

# Migrar BD en producción
npx prisma migrate deploy

# Deploy config de la app a Shopify
npm run deploy

# Iniciar servidor
npm run start
```

> **Docker:** El `Dockerfile` incluido ejecuta `npm run docker-start` que corre `prisma generate + migrate deploy + start` automáticamente.

---

## 5. Configurar la Conexión al ERP (desde la UI)

Una vez la app esté instalada en tu tienda Shopify:

1. Ve a **Shopify Admin → Apps → BH Shopify App**
2. Click en **"Configuración ERP"** (menú lateral)
3. Completa los campos:
   - **URL Base del ERP**: `https://tu-erp.com` (sin `/api/...` al final)
   - **API Key**: La clave que tu ERP espera
   - **Header de autenticación**: Normalmente `X-Api-Key` (o `Authorization` si usa Bearer)
   - **Sync automático**: Activar/desactivar el cron
   - **Intervalo de sync**: 5, 15, 30, 60 o 120 minutos
4. Click **"Probar Conexión"** para verificar que la app llega al ERP
5. Click **"Guardar"**

---

## 6. Revisar Productos y Campos que se Envían al ERP

### 6.1 Importar productos desde Shopify

1. Ve a **"Mapeo de Productos"** en el menú lateral
2. Click **"Importar desde Shopify"**
3. La app cargará todas las variantes que tengan SKU

### 6.2 Revisar el mapeo

La tabla de mapeo muestra exactamente qué se sincroniza:

| Columna | Descripción |
|---------|-------------|
| **Producto / Variante** | Nombre del producto y variante en Shopify |
| **Ubicación** | Location de Shopify (bodega/almacén) |
| **SKU ERP** | El código SKU que se envía al ERP (editable) |
| **Variant ID Shopify** | ID interno de la variante en Shopify |
| **Estado Sync** | `Activo` = se sincroniza, `Inactivo` = pausado |

### 6.3 Editar un mapeo

- Click **"Editar"** en cualquier fila para cambiar el SKU del ERP o activar/desactivar la sync
- Click **"Pausar"/"Activar"** para toggle rápido
- Click **"Eliminar"** para quitar el mapeo

### 6.4 Campos que se envían al ERP (Shopify → ERP)

Cuando el inventario cambia en Shopify, la app hace un `PUT /api/inventory/{sku}` con:

```json
{
  "sku": "PROD-001",
  "quantity": 50,
  "source": "shopify",
  "updatedAt": "2024-01-15T10:30:00.000Z",
  "shopifyVariantId": "gid://shopify/ProductVariant/123456",
  "shopifyLocationId": "gid://shopify/Location/789"
}
```

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `sku` | string | SKU del ERP (el que configuraste en el mapeo) |
| `quantity` | number | Cantidad disponible actual en Shopify |
| `source` | string | Siempre `"shopify"` |
| `updatedAt` | string (ISO 8601) | Timestamp del cambio |
| `shopifyVariantId` | string (GID) | ID de la variante de Shopify |
| `shopifyLocationId` | string (GID) | ID de la ubicación/bodega |

### 6.5 Campos que el ERP envía a Shopify (ERP → Shopify)

El ERP hace `POST /api/erp-webhook` con:

```json
{
  "sku": "PROD-001",
  "quantity": 50,
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

O en lote:

```json
{
  "items": [
    { "sku": "PROD-001", "quantity": 50 },
    { "sku": "PROD-002", "quantity": 10 }
  ]
}
```

Headers requeridos:
```
X-Webhook-Secret: <WEBHOOK_SECRET>
X-Shop-Domain: tu-tienda.myshopify.com
```

---

## 7. Verificar la Sync

### Dashboard

Ve al **Dashboard** (página principal de la app) para ver:
- Total de syncs, éxitos, fallos, pendientes
- Estado del auto-sync (activo/inactivo, última sync, intervalo)
- Últimas 10 operaciones de sync

### Historial de Sync

Ve a **"Historial de Sync"** para ver el log completo con filtros:
- Dirección: Shopify→ERP o ERP→Shopify
- Estado: Éxito, Fallido, Omitido
- SKU específico
- Cantidades antes/después del cambio
- Errores detallados si falló

### Sync Manual

Desde el Dashboard, click **"Sincronizar Todo"** para forzar una sync completa ERP→Shopify de todos los productos mapeados con sync activa.

---

## 8. Endpoints que tu ERP Debe Exponer

| Método | Endpoint | Respuesta esperada |
|--------|----------|-------------------|
| `GET` | `/api/inventory` | `[{ "sku": "X", "quantity": N }, ...]` |
| `GET` | `/api/inventory/{sku}` | `{ "sku": "X", "quantity": N }` |
| `PUT` | `/api/inventory/{sku}` | Objeto actualizado |
| `GET` | `/api/products` | `[{ "sku": "X", "name": "..." }]` (opcional) |
| `GET` | `/api/health` | Cualquier respuesta 200 (opcional) |

---

## 9. Troubleshooting

| Problema | Solución |
|----------|----------|
| "No ERP settings configured" | Ir a Configuración ERP y guardar la URL y API Key |
| "API Key inválida (401/403)" | Verificar la API Key y header en Configuración ERP |
| "No se puede conectar al servidor" | Verificar que la URL del ERP sea accesible desde el servidor de la app |
| "Timeout" | El ERP tarda mucho (>15s). Verificar rendimiento del ERP |
| "SKU no encontrado (404)" | El SKU mapeado no existe en el ERP. Editar el mapeo |
| Sync no se ejecuta automáticamente | Verificar que "Sync automático" esté activo en Settings |
| Productos sin SKU se omiten | Solo variantes con SKU en Shopify se importan al mapeo |

---

## Resumen Rápido

```
1. npm install && cp .env.example .env  → configurar variables
2. npx prisma migrate dev               → crear BD
3. npm run dev                           → iniciar en desarrollo
4. Instalar app en tienda Shopify
5. Configuración ERP → guardar URL + API Key + probar conexión
6. Mapeo de Productos → Importar desde Shopify
7. Revisar SKUs, activar sync por producto
8. Dashboard → verificar que todo sincroniza
```
