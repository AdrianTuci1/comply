using Comply.Functions.Api;
using Comply.Functions.Auth;

namespace Comply.Functions.Tests;

public sealed class CorsTests
{
    private static CorsSettings Production() =>
        CorsSettings.Resolve("https://app.comply.example", production: true);

    private static CorsSettings Development() =>
        CorsSettings.Resolve("http://localhost:4200", production: false);

    [Fact]
    public void Production_allows_the_configured_app_origin()
    {
        var headers = CorsPolicy.Build("https://app.comply.example", Production());

        Assert.Equal("https://app.comply.example", headers["Access-Control-Allow-Origin"]);
        Assert.Equal("GET,POST,PUT,PATCH,DELETE,OPTIONS", headers["Access-Control-Allow-Methods"]);
        Assert.Equal(
            "content-type,authorization,accept,mcp-protocol-version,mcp-session-id,x-comply-tenant",
            headers["Access-Control-Allow-Headers"]);
        Assert.Equal("86400", headers["Access-Control-Max-Age"]);
        Assert.Equal("origin", headers["Vary"]);
    }

    [Fact]
    public void Production_rejects_an_unknown_origin()
    {
        var headers = CorsPolicy.Build("https://evil.example.com", Production());

        Assert.False(headers.ContainsKey("Access-Control-Allow-Origin"));
        Assert.Empty(headers);
    }

    [Fact]
    public void Production_never_emits_a_wildcard()
    {
        var headers = CorsPolicy.Build("https://evil.example.com", Production());

        Assert.DoesNotContain("*", headers.Values);
    }

    [Fact]
    public void Development_allows_the_angular_dev_server()
    {
        var headers = CorsPolicy.Build("http://localhost:4200", Development());

        Assert.Equal("http://localhost:4200", headers["Access-Control-Allow-Origin"]);
        Assert.Contains("authorization", headers["Access-Control-Allow-Headers"]);
    }

    [Fact]
    public void Development_allows_local_tooling_on_other_ports()
    {
        var headers = CorsPolicy.Build("http://localhost:4300", Development());

        Assert.Equal("http://localhost:4300", headers["Access-Control-Allow-Origin"]);
    }

    [Fact]
    public void Requests_without_an_origin_get_no_cors_headers()
    {
        Assert.Empty(CorsPolicy.Build(null, Production()));
        Assert.Empty(CorsPolicy.Build("", Development()));
    }

    [Fact]
    public void Origin_matching_is_case_insensitive()
    {
        var headers = CorsPolicy.Build("HTTPS://APP.COMPLY.EXAMPLE", Production());

        Assert.Equal("HTTPS://APP.COMPLY.EXAMPLE", headers["Access-Control-Allow-Origin"]);
    }

    [Fact]
    public void Settings_default_to_the_angular_dev_server_outside_production()
    {
        var settings = CorsSettings.Resolve(null, production: false);

        Assert.Contains("http://localhost:4200", settings.AllowedOrigins);
    }

    [Fact]
    public void Settings_add_no_dev_origin_in_production()
    {
        var settings = CorsSettings.Resolve(null, production: true);

        Assert.Empty(settings.AllowedOrigins);
    }

    [Fact]
    public void The_app_url_accepts_a_comma_separated_origin_list()
    {
        var settings = CorsSettings.Resolve(
            "https://app.comply.example, https://cdn.comply.example/",
            production: true);

        Assert.Equal(
            new[] { "https://app.comply.example", "https://cdn.comply.example" },
            settings.AllowedOrigins);
        Assert.Equal(
            "https://cdn.comply.example",
            CorsPolicy.Build("https://cdn.comply.example", settings)["Access-Control-Allow-Origin"]);
    }

    [Fact]
    public void Extra_cors_origins_are_added_to_the_allowlist()
    {
        var settings = CorsSettings.Resolve(
            "https://app.comply.example",
            "https://static.comply.example, https://preview.comply.example",
            production: true);

        Assert.Equal(3, settings.AllowedOrigins.Count);
        Assert.True(settings.Allows("https://preview.comply.example"));
    }

    [Fact]
    public void Preflight_from_a_cdn_origin_advertises_the_mcp_headers()
    {
        var settings = CorsSettings.Resolve(
            "https://app.comply.example,https://cdn.comply.example",
            production: true);

        var headers = CorsPolicy.Build("https://cdn.comply.example", settings);

        Assert.Equal("https://cdn.comply.example", headers["Access-Control-Allow-Origin"]);
        Assert.Equal(CorsPolicy.AllowHeaders, headers["Access-Control-Allow-Headers"]);
        Assert.Contains("mcp-protocol-version", headers["Access-Control-Allow-Headers"]);
        Assert.Contains("x-comply-tenant", headers["Access-Control-Allow-Headers"]);
        Assert.Equal("origin", headers["Vary"]);
    }

    [Fact]
    public void Auth_uses_the_first_app_url_for_redirects()
    {
        var settings = AuthSettings.Resolve(
            "secret",
            "https://app.comply.example, https://cdn.comply.example",
            mailWebhookUrl: null,
            devLinks: null,
            production: true);

        Assert.Equal("https://app.comply.example", settings.AppBaseUrl);
    }
}
