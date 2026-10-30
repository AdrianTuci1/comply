using System.Text.Json.Nodes;
using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;

namespace Comply.Functions.Tests;

public sealed class TenantContextTests
{
    private static HttpRequest Request(string? token = null, string? header = null, string? cookie = null) =>
        TestRequest.Build("/api/agent/assessments", bearer: token, tenant: header, cookie: cookie);

    [Fact]
    public async Task A_session_resolves_to_the_users_organization_and_ignores_the_header()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();

        var plain = await fixture.Tenant.ResolveAsync(Request(session.Session));
        var withHeader = await fixture.Tenant.ResolveAsync(Request(session.Session, header: "helios"));

        Assert.Equal("nordwind", plain.Slug);
        Assert.True(plain.FromSession);
        Assert.Null(plain.Key);
        Assert.Equal("nordwind", withHeader.Slug);
    }

    [Fact]
    public async Task A_session_cookie_resolves_like_a_bearer_token()
    {
        using var fixture = new AgentFixture();
        var session = await fixture.RegisterAsync();

        var scope = await fixture.Tenant.ResolveAsync(
            Request(cookie: $"{SessionToken.CookieName}={session.Session}"));

        Assert.Equal("nordwind", scope.Slug);
    }

    [Fact]
    public async Task Development_selects_the_header_tenant_or_the_first_organization()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();

        var header = await fixture.Tenant.ResolveAsync(Request(header: "helios"));
        var fallback = await fixture.Tenant.ResolveAsync(Request());
        var unknown = await fixture.Tenant.ResolveAsync(Request(header: "does-not-exist"));

        Assert.Equal("helios", header.Slug);
        Assert.Equal("nordwind", fallback.Slug);
        Assert.Equal("nordwind", unknown.Slug);
        Assert.False(header.FromSession);
    }

    [Fact]
    public async Task A_key_resolves_to_its_own_organization()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        var created = await fixture.Keys.CreateAsync(fixture.Organization!, "CI", new JsonArray("read"));

        var scope = await fixture.Tenant.ResolveAsync(Request(created.Secret));
        var sameHeader = await fixture.Tenant.ResolveAsync(Request(created.Secret, header: "nordwind"));

        Assert.Equal("nordwind", scope.Slug);
        Assert.Equal(created.Key.Id, scope.Key!.Key.Id);
        Assert.False(scope.FromSession);
        Assert.Equal("nordwind", sameHeader.Slug);
    }

    [Fact]
    public async Task A_key_rejects_a_conflicting_tenant_header()
    {
        using var fixture = new AgentFixture();
        await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();
        var created = await fixture.Keys.CreateAsync(fixture.Organization!, "CI", new JsonArray("read"));

        var error = await Assert.ThrowsAsync<TenantException>(
            () => fixture.Tenant.ResolveAsync(Request(created.Secret, header: "helios")));

        Assert.Equal(403, error.Status);
        Assert.Equal("The tenant header does not match the tenant in the MCP key.", error.Message);
    }

    [Fact]
    public async Task Production_rejects_requests_without_a_session_or_key()
    {
        using var fixture = new AgentFixture(devLinks: false, production: true);
        await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();

        var anonymous = await Assert.ThrowsAsync<TenantException>(
            () => fixture.Tenant.ResolveAsync(Request(header: "helios")));
        var forged = await Assert.ThrowsAsync<TenantException>(
            () => fixture.Tenant.ResolveAsync(Request($"sk_mcp_nordwind_{new string('a', 64)}")));

        Assert.Equal(401, anonymous.Status);
        Assert.Equal("Not signed in.", anonymous.Message);
        Assert.Equal(401, forged.Status);
    }

    [Fact]
    public async Task Production_accepts_a_session_or_an_mcp_key()
    {
        using var fixture = new AgentFixture(devLinks: false, production: true);
        var session = await fixture.RegisterAsync();
        await fixture.OtherOrganizationAsync();
        var created = await fixture.Keys.CreateAsync(fixture.Organization!, "CI", new JsonArray("read"));

        var bySession = await fixture.Tenant.ResolveAsync(Request(session.Session));
        var byKey = await fixture.Tenant.ResolveAsync(Request(created.Secret));

        Assert.Equal("nordwind", bySession.Slug);
        Assert.Equal("nordwind", byKey.Slug);
        Assert.NotNull(byKey.Key);
    }

    [Fact]
    public async Task A_well_formed_session_token_for_an_unknown_user_is_not_signed_in()
    {
        using var fixture = new AgentFixture(devLinks: false, production: true);
        await fixture.RegisterAsync();
        var token = fixture.Tokens.SignSession("nobody@example.com");

        var error = await Assert.ThrowsAsync<TenantException>(
            () => fixture.Tenant.ResolveAsync(Request(token)));

        Assert.Equal(401, error.Status);
    }
}
