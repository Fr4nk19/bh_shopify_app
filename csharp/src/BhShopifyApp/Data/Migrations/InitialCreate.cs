using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace BhShopifyApp.Data.Migrations;

/// <summary>
/// Initial database migration — creates all tables.
/// Run with: dotnet ef database update
/// </summary>
public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Sessions",
            columns: table => new
            {
                Id          = table.Column<string>(nullable: false),
                Shop        = table.Column<string>(maxLength: 255, nullable: false),
                AccessToken = table.Column<string>(nullable: false),
                Scopes      = table.Column<string>(nullable: false),
                CreatedAt   = table.Column<DateTime>(nullable: false),
                UpdatedAt   = table.Column<DateTime>(nullable: false),
            },
            constraints: t => t.PrimaryKey("PK_Sessions", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_Sessions_Shop", table: "Sessions",
            column: "Shop", unique: true);

        migrationBuilder.CreateTable(
            name: "ShopSettings",
            columns: table => new
            {
                Id                  = table.Column<string>(nullable: false),
                Shop                = table.Column<string>(maxLength: 255, nullable: false),
                ErpBaseUrl          = table.Column<string>(nullable: false),
                ErpApiKey           = table.Column<string>(nullable: false),
                ErpApiHeader        = table.Column<string>(nullable: false, defaultValue: "X-Api-Key"),
                SyncEnabled         = table.Column<bool>(nullable: false, defaultValue: true),
                SyncIntervalMinutes = table.Column<int>(nullable: false, defaultValue: 15),
                LastSyncAt          = table.Column<DateTime>(nullable: true),
                CreatedAt           = table.Column<DateTime>(nullable: false),
                UpdatedAt           = table.Column<DateTime>(nullable: false),
            },
            constraints: t => t.PrimaryKey("PK_ShopSettings", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_ShopSettings_Shop", table: "ShopSettings",
            column: "Shop", unique: true);

        migrationBuilder.CreateTable(
            name: "ProductMappings",
            columns: table => new
            {
                Id                      = table.Column<string>(nullable: false),
                Shop                    = table.Column<string>(maxLength: 255, nullable: false),
                ShopifyProductId        = table.Column<string>(nullable: false),
                ShopifyVariantId        = table.Column<string>(nullable: false),
                ShopifyInventoryItemId  = table.Column<string>(nullable: false),
                ShopifyLocationId       = table.Column<string>(nullable: false),
                ProductTitle            = table.Column<string>(nullable: false),
                VariantTitle            = table.Column<string>(nullable: true),
                ErpSku                  = table.Column<string>(nullable: false),
                SyncEnabled             = table.Column<bool>(nullable: false, defaultValue: false),
                CreatedAt               = table.Column<DateTime>(nullable: false),
                UpdatedAt               = table.Column<DateTime>(nullable: false),
            },
            constraints: t => t.PrimaryKey("PK_ProductMappings", x => x.Id));

        migrationBuilder.CreateIndex(
            name: "IX_ProductMappings_Shop_Variant_Location",
            table: "ProductMappings",
            columns: ["Shop", "ShopifyVariantId", "ShopifyLocationId"],
            unique: true);

        migrationBuilder.CreateIndex(
            name: "IX_ProductMappings_Shop", table: "ProductMappings", column: "Shop");
        migrationBuilder.CreateIndex(
            name: "IX_ProductMappings_Shop_Sku", table: "ProductMappings",
            columns: ["Shop", "ErpSku"]);

        migrationBuilder.CreateTable(
            name: "SyncLogs",
            columns: table => new
            {
                Id               = table.Column<string>(nullable: false),
                Shop             = table.Column<string>(maxLength: 255, nullable: false),
                Direction        = table.Column<int>(nullable: false),
                Status           = table.Column<int>(nullable: false),
                Source           = table.Column<string>(nullable: false),
                ErpSku           = table.Column<string>(nullable: true),
                ShopifyVariantId = table.Column<string>(nullable: true),
                QuantityBefore   = table.Column<int>(nullable: true),
                QuantityAfter    = table.Column<int>(nullable: true),
                ErrorMessage     = table.Column<string>(nullable: true),
                CreatedAt        = table.Column<DateTime>(nullable: false),
            },
            constraints: t => t.PrimaryKey("PK_SyncLogs", x => x.Id));

        migrationBuilder.CreateIndex("IX_SyncLogs_Shop", "SyncLogs", "Shop");
        migrationBuilder.CreateIndex("IX_SyncLogs_Shop_CreatedAt", "SyncLogs",
            ["Shop", "CreatedAt"]);
        migrationBuilder.CreateIndex("IX_SyncLogs_Status", "SyncLogs", "Status");

        migrationBuilder.CreateTable(
            name: "SyncQueues",
            columns: table => new
            {
                Id                = table.Column<string>(nullable: false),
                Shop              = table.Column<string>(maxLength: 255, nullable: false),
                Direction         = table.Column<int>(nullable: false),
                ErpSku            = table.Column<string>(nullable: true),
                ShopifyVariantId  = table.Column<string>(nullable: true),
                ShopifyLocationId = table.Column<string>(nullable: true),
                Quantity          = table.Column<int>(nullable: true),
                Attempts          = table.Column<int>(nullable: false, defaultValue: 0),
                MaxAttempts       = table.Column<int>(nullable: false, defaultValue: 3),
                Status            = table.Column<int>(nullable: false, defaultValue: 0),
                ErrorMessage      = table.Column<string>(nullable: true),
                ScheduledAt       = table.Column<DateTime>(nullable: false),
                ProcessedAt       = table.Column<DateTime>(nullable: true),
                CreatedAt         = table.Column<DateTime>(nullable: false),
                UpdatedAt         = table.Column<DateTime>(nullable: false),
            },
            constraints: t => t.PrimaryKey("PK_SyncQueues", x => x.Id));

        migrationBuilder.CreateIndex("IX_SyncQueues_Shop_Status", "SyncQueues",
            ["Shop", "Status"]);
        migrationBuilder.CreateIndex("IX_SyncQueues_Status_ScheduledAt", "SyncQueues",
            ["Status", "ScheduledAt"]);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable("SyncQueues");
        migrationBuilder.DropTable("SyncLogs");
        migrationBuilder.DropTable("ProductMappings");
        migrationBuilder.DropTable("ShopSettings");
        migrationBuilder.DropTable("Sessions");
    }
}
