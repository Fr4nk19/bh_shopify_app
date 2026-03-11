using BhShopifyApp.Data;
using BhShopifyApp.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ShopifySharp;
using ShopifySharp.Filters;

namespace BhShopifyApp.Controllers;

/// <summary>
/// Handles the Shopify OAuth2 install and callback flow.
/// GET /auth/install?shop=xxx.myshopify.com  → redirects to Shopify permission screen
/// GET /auth/callback                         → exchanges code for access token
/// </summary>
[Route("auth")]
public class AuthController(
    IConfiguration config,
    AppDbContext db,
    ILogger<AuthController> logger) : Controller
{
    private string ApiKey => config["Shopify:ApiKey"]!;
    private string ApiSecret => config["Shopify:ApiSecret"]!;
    private string AppUrl => config["Shopify:AppUrl"]!;
    private string Scopes => config["Shopify:Scopes"]!;

    // ── Step 1: Initiate OAuth ────────────────────────────────────────────────

    [HttpGet("install")]
    public IActionResult Install([FromQuery] string shop)
    {
        if (string.IsNullOrWhiteSpace(shop))
            return BadRequest("Missing 'shop' query parameter.");

        var redirectUrl = $"{AppUrl}/auth/callback";
        var authUrl = AuthorizationService.BuildAuthorizationUrl(
            Scopes.Split(','),
            shop,
            ApiKey,
            new Uri(redirectUrl));

        return Redirect(authUrl.ToString());
    }

    // ── Step 2: OAuth Callback ────────────────────────────────────────────────

    [HttpGet("callback")]
    public async Task<IActionResult> Callback(
        [FromQuery] string code,
        [FromQuery] string shop,
        [FromQuery] string hmac,
        [FromQuery] string state)
    {
        // Validate HMAC
        var queryString = Request.QueryString.Value!;
        if (!AuthorizationService.IsAuthenticRequest(
                Request.Query.ToDictionary(k => k.Key, v => v.Value.ToString()),
                ApiSecret))
        {
            logger.LogWarning("[Auth] Invalid HMAC for shop={Shop}", shop);
            return Unauthorized("Invalid HMAC signature.");
        }

        // Exchange code for access token
        string accessToken;
        try
        {
            accessToken = await AuthorizationService.Authorize(
                code, shop, ApiKey, ApiSecret);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[Auth] Token exchange failed for shop={Shop}", shop);
            return BadRequest("Failed to obtain access token.");
        }

        // Persist session
        var existing = await db.Sessions.FirstOrDefaultAsync(s => s.Shop == shop);
        if (existing is null)
        {
            db.Sessions.Add(new ShopSession
            {
                Shop = shop,
                AccessToken = accessToken,
                Scopes = Scopes,
            });
        }
        else
        {
            existing.AccessToken = accessToken;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();

        logger.LogInformation("[Auth] Shop installed/updated: {Shop}", shop);

        // Redirect into the embedded app
        return Redirect($"https://{shop}/admin/apps/{ApiKey}");
    }
}
