using System.Text.Json.Nodes;
using Comply.Functions.Services;

namespace Comply.Functions.Tests;

public sealed class McpKeyServiceTests
{
    private static JsonArray Scopes(params string[] scopes)
    {
        var array = new JsonArray();
        foreach (var scope in scopes) array.Add(scope);
        return array;
    }

    [Fact]
    public async Task Creates_a_tenant_bound_key_in_the_node_format()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();

        var created = await fixture.Keys.CreateAsync(
            organization,
            "CI harness",
            Scopes("read", "evidence:write"));

        Assert.Matches("^sk_mcp_nordwind_[a-f0-9]{64}$", created.Secret);
        Assert.StartsWith("sk_mcp_nordwind_", created.Key.Prefix);
        Assert.Equal(6, created.Key.Prefix["sk_mcp_nordwind_".Length..].Length);
        Assert.Equal("nordwind", created.Key.TenantId);
        Assert.Equal("CI harness", created.Key.Name);
        Assert.Equal(new[] { "read", "evidence:write" }, created.Key.Scopes);
        Assert.StartsWith("key-", created.Key.Id);
        Assert.Equal("2026-10-30T12:00:00.000Z", Comply.Functions.Agent.AgentJson.Timestamp(created.Key.CreatedAt));
        Assert.Null(created.Key.LastUsedAt);
        Assert.Null(created.Key.RevokedAt);

        var json = created.Key.ToJson();
        Assert.Null(json["hash"]);
        Assert.Equal(
            new[] { "id", "tenantId", "name", "prefix", "scopes", "createdAt", "lastUsedAt", "revokedAt" },
            json.Select(entry => entry.Key).ToArray());
    }

    [Fact]
    public async Task Authenticates_only_the_exact_token_for_its_tenant()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();
        var created = await fixture.Keys.CreateAsync(organization, "CI harness", Scopes("read"));
        await fixture.OtherOrganizationAsync();

        var identity = await fixture.Keys.AuthenticateAsync(created.Secret);

        Assert.NotNull(identity);
        Assert.Equal("nordwind", identity!.Organization.Slug);
        Assert.Equal(created.Key.Id, identity.Key.Id);

        var forged = await fixture.Keys.AuthenticateAsync($"sk_mcp_nordwind_{new string('b', 64)}");
        var wrongTenant = await fixture.Keys.AuthenticateAsync($"sk_mcp_helios_{created.Secret[^64..]}");
        var malformed = await fixture.Keys.AuthenticateAsync("sk_mcp_nordwind_short");
        var missing = await fixture.Keys.AuthenticateAsync(null);

        Assert.Null(forged);
        Assert.Null(wrongTenant);
        Assert.Null(malformed);
        Assert.Null(missing);
    }

    [Fact]
    public async Task Lists_keys_newest_first_and_only_for_the_tenant()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();
        var other = await fixture.OtherOrganizationAsync();

        var first = await fixture.Keys.CreateAsync(organization, "First", Scopes("read"));
        fixture.Time.Advance(TimeSpan.FromMinutes(1));
        var second = await fixture.Keys.CreateAsync(organization, "Second", Scopes("read"));
        await fixture.Keys.CreateAsync(other, "Other", Scopes("read"));

        var keys = await fixture.Keys.ListAsync(organization);
        var otherKeys = await fixture.Keys.ListAsync(other);

        Assert.Equal(new[] { second.Key.Id, first.Key.Id }, keys.Select(key => key.Id).ToArray());
        Assert.Single(otherKeys);
        Assert.Equal("Other", otherKeys[0].Name);
    }

    [Fact]
    public async Task Revocation_is_idempotent_and_tenant_scoped()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();
        var other = await fixture.OtherOrganizationAsync();
        var created = await fixture.Keys.CreateAsync(organization, "CI harness", Scopes("read"));

        var revoked = await fixture.Keys.RevokeAsync(organization, created.Key.Id);
        fixture.Time.Advance(TimeSpan.FromMinutes(10));
        var again = await fixture.Keys.RevokeAsync(organization, created.Key.Id);

        Assert.NotNull(revoked.RevokedAt);
        Assert.Equal(revoked.RevokedAt, again.RevokedAt);
        Assert.Null(await fixture.Keys.AuthenticateAsync(created.Secret));

        var missing = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.RevokeAsync(organization, "key-missing"));
        var foreign = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.RevokeAsync(other, created.Key.Id));

        Assert.Equal(404, missing.Status);
        Assert.Equal("The key was not found.", missing.Message);
        Assert.Equal(404, foreign.Status);
    }

    [Fact]
    public async Task Rejects_an_unnamed_or_misscoped_key()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();

        var name = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.CreateAsync(organization, "  ", Scopes("read")));
        var empty = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.CreateAsync(organization, "CI", new JsonArray()));
        var missing = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.CreateAsync(organization, "CI", null));
        var unknown = await Assert.ThrowsAsync<McpKeyException>(
            () => fixture.Keys.CreateAsync(organization, "CI", Scopes("read", "write")));

        Assert.Equal(400, name.Status);
        Assert.Equal("invalid_name", name.Code);
        Assert.Equal("The key needs a name.", name.Message);
        Assert.Equal("invalid_scopes", empty.Code);
        Assert.Equal("Choose at least one permission for the key.", empty.Message);
        Assert.Equal("invalid_scopes", missing.Code);
        Assert.Equal("invalid_scopes", unknown.Code);
        Assert.Equal("Unknown access scope: write.", unknown.Message);
    }

    [Fact]
    public async Task Last_used_is_written_at_most_once_per_minute()
    {
        using var fixture = new AgentFixture();
        var organization = await fixture.OrganizationAsync();
        var created = await fixture.Keys.CreateAsync(organization, "CI harness", Scopes("read"));

        await fixture.Keys.AuthenticateAsync(created.Secret);
        var first = (await fixture.Keys.ListAsync(organization))[0].LastUsedAt;
        fixture.Time.Advance(TimeSpan.FromSeconds(30));
        await fixture.Keys.AuthenticateAsync(created.Secret);
        var second = (await fixture.Keys.ListAsync(organization))[0].LastUsedAt;
        fixture.Time.Advance(TimeSpan.FromSeconds(31));
        await fixture.Keys.AuthenticateAsync(created.Secret);
        var third = (await fixture.Keys.ListAsync(organization))[0].LastUsedAt;

        Assert.Equal(first, second);
        Assert.NotEqual(first, third);
    }
}
