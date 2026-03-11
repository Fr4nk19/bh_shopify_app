# BH Shopify App — C# ASP.NET Core

App de Shopify en C# (.NET 8) para sincronización de inventario bidireccional con ERP,
construida con el patrón de **Inyección de Dependencias** de ASP.NET Core.

## Stack

| Capa | Tecnología |
|------|-----------|
| Web framework | ASP.NET Core 8 (Razor Pages + MVC Controllers) |
| ORM | Entity Framework Core 8 con PostgreSQL (Npgsql) |
| HTTP client | `IHttpClientFactory` + Resilience (Polly) |
| Cron jobs | Quartz.NET 3 |
| Shopify Auth | ShopifySharp |
| Logging | Serilog |

## Patrón de Diseño: Inyección de Dependencias

Cada capa depende de **interfaces**, nunca de implementaciones concretas:

```
IErpService          ← ErpService           (HTTP a ERP C#)
IShopifyInventoryService ← ShopifyInventoryService (GraphQL a Shopify)
ISyncService         ← SyncService          (orquestador)
```

El registro se organiza en **extension methods** por responsabilidad:

```csharp
// Program.cs — composition root limpio
builder.Services
    .AddDatabase(config)       // EF Core + PostgreSQL
    .AddErpServices(config)    // IErpService + typed HttpClient
    .AddShopifyServices()      // IShopifyInventoryService + typed HttpClient
    .AddSyncServices()         // ISyncService
    .AddCronJobs();            // Quartz (InventorySyncJob, RetryQueueJob)
```

## Estructura del Proyecto

```
csharp/
└── src/BhShopifyApp/
    ├── Program.cs                          # Composition root (DI + pipeline)
    ├── Extensions/
    │   └── ServiceCollectionExtensions.cs  # Grupos de registro DI
    ├── Controllers/
    │   ├── AuthController.cs               # OAuth Shopify
    │   ├── WebhookController.cs            # Webhooks Shopify (HMAC)
    │   └── ErpWebhookController.cs         # Push ERP → App
    ├── Pages/App/
    │   ├── Index     (Dashboard)
    │   ├── Settings  (Config ERP)
    │   ├── Products  (Mapeo SKU)
    │   └── SyncLog   (Historial)
    ├── Services/
    │   ├── Erp/
    │   │   ├── IErpService.cs
    │   │   └── ErpService.cs
    │   ├── Shopify/
    │   │   ├── IShopifyInventoryService.cs
    │   │   └── ShopifyInventoryService.cs
    │   ├── Sync/
    │   │   ├── ISyncService.cs
    │   │   └── SyncService.cs
    │   └── Cron/
    │       ├── InventorySyncJob.cs
    │       └── RetryQueueJob.cs
    ├── Models/                             # Entidades EF Core
    ├── DTOs/                               # Records de transferencia
    └── Data/
        ├── AppDbContext.cs
        └── Migrations/
```

## Requisitos

- .NET 8 SDK
- PostgreSQL 14+
- Cuenta Shopify Partners

## Setup

```bash
# 1. Restaurar dependencias
cd csharp
dotnet restore

# 2. Configurar User Secrets (desarrollo)
cd src/BhShopifyApp
dotnet user-secrets set "Shopify:ApiKey"        "your_key"
dotnet user-secrets set "Shopify:ApiSecret"     "your_secret"
dotnet user-secrets set "Sync:WebhookSecret"    "your_secret"
dotnet user-secrets set "ConnectionStrings:DefaultConnection" \
    "Host=localhost;Database=bh_shopify_app;Username=postgres;Password=postgres"

# 3. Ejecutar migraciones
dotnet ef database update

# 4. Iniciar
dotnet run
```

## Endpoints del ERP Esperados

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/inventory` | Listar todo el inventario |
| GET | `/api/inventory/{sku}` | Stock de un SKU |
| PUT | `/api/inventory/{sku}` | Actualizar stock |
| GET | `/api/health` | Health check (opcional) |

## Endpoint Push ERP → App

```
POST /api/erp-webhook
Headers:
  X-Webhook-Secret: {Sync:WebhookSecret}
  X-Shop-Domain:    mi-tienda.myshopify.com
Body:
  { "sku": "PROD-001", "quantity": 50 }
  // batch:
  { "items": [{ "sku": "PROD-001", "quantity": 50 }] }
```

## Flujo de Autenticación

```
Browser → GET /auth/install?shop=xxx.myshopify.com
        → Redirect a Shopify OAuth
        → Shopify → GET /auth/callback?code=...
        → App intercambia code por access_token
        → Guarda en ShopSessions
        → Redirige a /app embebido en Shopify Admin
```

## Producción

```bash
dotnet publish -c Release -o ./publish
# Configurar variables de entorno en el servidor
# Ejecutar: dotnet BhShopifyApp.dll
```
