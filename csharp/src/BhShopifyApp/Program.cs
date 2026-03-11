using BhShopifyApp.Data;
using BhShopifyApp.Extensions;
using Microsoft.EntityFrameworkCore;
using Serilog;

// ── Bootstrap Serilog early so startup errors are captured ──────────────────
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateBootstrapLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // ── Serilog ───────────────────────────────────────────────────────────────
    builder.Host.UseSerilog((ctx, services, cfg) =>
        cfg.ReadFrom.Configuration(ctx.Configuration)
           .ReadFrom.Services(services)
           .Enrich.FromLogContext()
           .WriteTo.Console());

    // ── MVC + Razor Pages ─────────────────────────────────────────────────────
    builder.Services.AddControllersWithViews();
    builder.Services.AddRazorPages();
    builder.Services.AddAntiforgery();

    // ── Application Services (Dependency Injection) ───────────────────────────
    //
    // Each extension method encapsulates a cohesive slice of registrations:
    //   AddDatabase           → EF Core + PostgreSQL
    //   AddErpServices        → IErpService + typed HttpClient
    //   AddShopifyServices    → IShopifyInventoryService + typed HttpClient
    //   AddSyncServices       → ISyncService (orchestrator)
    //   AddCronJobs           → Quartz.NET jobs (InventorySyncJob, RetryQueueJob)
    //
    builder.Services
        .AddDatabase(builder.Configuration)
        .AddErpServices(builder.Configuration)
        .AddShopifyServices()
        .AddSyncServices()
        .AddCronJobs();

    // ── Health checks ─────────────────────────────────────────────────────────
    builder.Services.AddHealthChecks()
        .AddDbContextCheck<AppDbContext>("database");

    var app = builder.Build();

    // ── Auto-migrate on startup (dev convenience; use explicit migrations in prod) ──
    if (app.Environment.IsDevelopment())
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }

    // ── Middleware pipeline ───────────────────────────────────────────────────
    if (!app.Environment.IsDevelopment())
    {
        app.UseExceptionHandler("/Error");
        app.UseHsts();
    }

    app.UseHttpsRedirection();
    app.UseStaticFiles();
    app.UseSerilogRequestLogging();
    app.UseRouting();
    app.UseAntiforgery();

    app.MapControllers();      // AuthController, WebhookController, ErpWebhookController
    app.MapRazorPages();       // /app, /app/settings, /app/products, /app/sync-log
    app.MapHealthChecks("/health");

    // ── Default redirect ──────────────────────────────────────────────────────
    app.MapGet("/", ctx =>
    {
        ctx.Response.Redirect("/app");
        return Task.CompletedTask;
    });

    await app.RunAsync();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
