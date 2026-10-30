using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Comply.Functions.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Comply.Functions.Tests;

/// <summary>Fixed-response HTTP handler so provider and webhook calls never leave the test.</summary>
internal sealed class StubHandler(HttpStatusCode status, string body) : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken) =>
        Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });
}

/// <summary>TimeProvider with a controllable clock for token and session expiry tests.</summary>
internal sealed class MutableTimeProvider(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public void Advance(TimeSpan delta) => Now = Now.Add(delta);
}

/// <summary>
/// Wires the auth stack against an isolated EF Core InMemory database. No Azure services, no
/// network, and every fixture gets its own store.
/// </summary>
internal sealed class AuthFixture : IDisposable
{
    public static readonly DateTimeOffset Start = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private readonly string _databaseName = $"comply-tests-{Guid.NewGuid():N}";

    public AuthFixture(
        IReadOnlyDictionary<string, string>? providerEnv = null,
        string? mailWebhookUrl = null,
        bool devLinks = true,
        string? appUrl = "http://localhost:4200",
        HttpMessageHandler? handler = null)
    {
        Time = new MutableTimeProvider(Start);
        Settings = new AuthSettings(
            "test-auth-secret",
            appUrl,
            mailWebhookUrl,
            DevLinks: devLinks,
            IsProduction: false);

        var options = new DbContextOptionsBuilder<ComplyDbContext>()
            .UseInMemoryDatabase(_databaseName)
            .Options;

        Factory = new PooledDbContextFactory<ComplyDbContext>(options);
        Database = new ComplyDatabase(Factory);
        Store = new EfComplyStore(Database);
        Users = new UserDirectory(Store, Time);
        Tokens = new AuthTokenService(Settings.Secret, Time);
        Auth = new AuthService(Users, Tokens, new PasswordHasher(), Time);
        Providers = OidcProviderCatalog.FromLookup(name =>
            providerEnv is not null && providerEnv.TryGetValue(name, out var value) ? value : null);
        Http = handler is null ? new HttpClient() : new HttpClient(handler);
        Oidc = new OidcService(Providers, Tokens, Http, Time);
        Api = new AuthApi(Auth, Oidc, Settings, new DeploymentSettings(null, null, null, null), Http);
    }

    public MutableTimeProvider Time { get; }
    public AuthSettings Settings { get; }
    public PooledDbContextFactory<ComplyDbContext> Factory { get; }
    public ComplyDatabase Database { get; }
    public EfComplyStore Store { get; }
    public UserDirectory Users { get; }
    public AuthTokenService Tokens { get; }
    public AuthService Auth { get; }
    public IReadOnlyList<OidcProvider> Providers { get; }
    public HttpClient Http { get; }
    public OidcService Oidc { get; }
    public AuthApi Api { get; }

    public async Task<ApiResponse> SendAsync(
        string path,
        string method = "GET",
        string? json = null,
        string? bearer = null,
        string? query = null,
        string? cookie = null)
    {
        var request = TestRequest.Build(path, method, json, bearer, query, cookie: cookie);
        var normalized = path.Split('?')[0].TrimEnd('/');
        var response = await Api.TryHandleAsync(request, normalized, CancellationToken.None);
        return response ?? throw new InvalidOperationException($"The auth API did not handle {path}.");
    }

    public async Task<ComplyDbContext> CreateContextAsync() => await Factory.CreateDbContextAsync();

    public void Dispose() => Http.Dispose();
}

internal static class TestRequest
{
    public static HttpRequest Build(
        string path,
        string method = "GET",
        string? json = null,
        string? bearer = null,
        string? query = null,
        string? origin = null,
        string? cookie = null,
        string? tenant = null,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost");
        if (query is not null) context.Request.QueryString = new QueryString(query);
        if (json is not null)
        {
            context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(json));
            context.Request.ContentType = "application/json";
        }

        if (bearer is not null) context.Request.Headers.Authorization = $"Bearer {bearer}";
        if (origin is not null) context.Request.Headers.Origin = origin;
        if (cookie is not null) context.Request.Headers.Cookie = cookie;
        if (tenant is not null) context.Request.Headers["x-comply-tenant"] = tenant;

        if (headers is not null)
        {
            foreach (var (name, value) in headers) context.Request.Headers[name] = value;
        }

        return context.Request;
    }
}

internal static class TestJson
{
    public static JsonNode Body(ApiResponse response) =>
        JsonNode.Parse(JsonSerializer.Serialize(
            response.Body,
            response.Body!.GetType(),
            JsonDefaults.Serializer))!;

    public static string? Error(ApiResponse response) =>
        response.Body is null ? null : JsonNode.Parse(JsonSerializer.Serialize(
            response.Body,
            response.Body.GetType(),
            JsonDefaults.Serializer))!["error"]?.GetValue<string>();
}
