using BhShopifyApp.Data;
using BhShopifyApp.Services.Cron;
using BhShopifyApp.Services.Erp;
using BhShopifyApp.Services.Shopify;
using BhShopifyApp.Services.Sync;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace BhShopifyApp.Extensions;

/// <summary>
/// Extension methods that group DI registrations by concern.
/// Called from Program.cs to keep the composition root clean.
/// </summary>
public static class ServiceCollectionExtensions
{
    // ── Database ──────────────────────────────────────────────────────────────

    /// <summary>Registers EF Core with PostgreSQL.</summary>
    public static IServiceCollection AddDatabase(
        this IServiceCollection services, IConfiguration config)
    {
        services.AddDbContext<AppDbContext>(opts =>
            opts.UseNpgsql(config.GetConnectionString("DefaultConnection"),
                npg => npg.EnableRetryOnFailure(3)));

        return services;
    }

    // ── ERP ───────────────────────────────────────────────────────────────────

    /// <summary>
    /// Registers the typed HTTP client for the ERP and the IErpService.
    /// The base URL / auth headers are applied per-request inside ErpService
    /// (because they differ per shop), so only resilience policies are set here.
    /// </summary>
    public static IServiceCollection AddErpServices(
        this IServiceCollection services, IConfiguration config)
    {
        services
            .AddHttpClient("erp", client =>
            {
                client.Timeout = TimeSpan.FromSeconds(
                    config.GetValue("Erp:TimeoutSeconds", 15));
            })
            .AddStandardResilienceHandler(); // Polly retry + circuit breaker

        services.AddScoped<IErpService, ErpService>();
        return services;
    }

    // ── Shopify ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Registers the HTTP client used to call Shopify's Admin GraphQL API
    /// and the IShopifyInventoryService.
    /// </summary>
    public static IServiceCollection AddShopifyServices(
        this IServiceCollection services)
    {
        services
            .AddHttpClient("shopify-graphql", client =>
            {
                client.DefaultRequestHeaders.Add("Accept", "application/json");
                client.Timeout = TimeSpan.FromSeconds(20);
            })
            .AddStandardResilienceHandler();

        services.AddScoped<IShopifyInventoryService, ShopifyInventoryService>();
        return services;
    }

    // ── Sync ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Registers the sync orchestrator.
    /// Scoped because it writes to the DB and must share the same
    /// DbContext within a single request/job execution.
    /// </summary>
    public static IServiceCollection AddSyncServices(
        this IServiceCollection services)
    {
        services.AddScoped<ISyncService, SyncService>();
        return services;
    }

    // ── Quartz (Cron Jobs) ────────────────────────────────────────────────────

    /// <summary>
    /// Registers Quartz.NET with two recurring jobs:
    ///   • InventorySyncJob  – every 5 minutes (checks per-shop interval internally)
    ///   • RetryQueueJob     – every 2 minutes
    /// </summary>
    public static IServiceCollection AddCronJobs(
        this IServiceCollection services)
    {
        services.AddQuartz(q =>
        {
            q.UseMicrosoftDependencyInjectionJobFactory();

            // ── Inventory Sync ────────────────────────────────────────────────
            var syncKey = new JobKey("inventory-sync");
            q.AddJob<InventorySyncJob>(opts => opts.WithIdentity(syncKey));
            q.AddTrigger(opts => opts
                .ForJob(syncKey)
                .WithIdentity("inventory-sync-trigger")
                .WithCronSchedule("0 */5 * * * ?") // every 5 minutes
                .StartNow());

            // ── Retry Queue ───────────────────────────────────────────────────
            var retryKey = new JobKey("retry-queue");
            q.AddJob<RetryQueueJob>(opts => opts.WithIdentity(retryKey));
            q.AddTrigger(opts => opts
                .ForJob(retryKey)
                .WithIdentity("retry-queue-trigger")
                .WithCronSchedule("0 */2 * * * ?") // every 2 minutes
                .StartNow());
        });

        services.AddQuartzHostedService(opt => opt.WaitForJobsToComplete = true);
        return services;
    }
}
