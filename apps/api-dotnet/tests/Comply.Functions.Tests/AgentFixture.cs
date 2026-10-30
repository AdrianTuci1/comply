using System.Text;
using System.Text.Json.Nodes;
using Comply.Functions.Agent;
using Comply.Functions.Api;
using Comply.Functions.Auth;
using Comply.Functions.Data;
using Comply.Functions.Models;
using Comply.Functions.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace Comply.Functions.Tests;

/// <summary>
/// Wires the agent stack against an isolated EF Core InMemory database and a small content
/// library. Time and generated identifiers are deterministic so responses can be asserted byte
/// for byte.
/// </summary>
internal sealed class AgentFixture : IDisposable
{
    public const string NordwindEmail = "ada@example.com";
    public const string OtherSlug = "helios";

    public static readonly DateTimeOffset Start = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);

    private readonly string _databaseName = $"comply-agent-tests-{Guid.NewGuid():N}";
    private readonly TempWorkspace _workspace = new();
    private int _ids;
    private int _secrets;

    public AgentFixture(bool devLinks = true, bool production = false)
    {
        Time = new MutableTimeProvider(Start);
        Settings = new AuthSettings(
            "test-auth-secret",
            "http://localhost:4200",
            MailWebhookUrl: null,
            DevLinks: devLinks,
            IsProduction: production);

        var options = new DbContextOptionsBuilder<ComplyDbContext>()
            .UseInMemoryDatabase(_databaseName)
            .Options;

        Factory = new PooledDbContextFactory<ComplyDbContext>(options);
        Database = new ComplyDatabase(Factory);
        Tokens = new AuthTokenService(Settings.Secret, Time);
        Users = new UserDirectory(Database, Time);
        Auth = new AuthService(Users, Tokens, new PasswordHasher(), Time);

        _workspace.WriteLibrary(_workspace.DataDirectory, Library());
        Store = new LibraryStore(_workspace.DataDirectory, _workspace.SeedDirectory);
        Agent = new AgentService(Database, Store, Time, NextId);
        Keys = new McpKeyService(Database, Time, NextSecret);
        Tenant = new TenantContext(Tokens, Users, Keys, Settings, Database);
        McpApi = new AgentApi(Agent, Keys, Tenant);
        Api = new ContentApi(
            Store,
            Time,
            new DeploymentSettings(null, null, null, null),
            auth: null,
            agent: McpApi);
    }

    public MutableTimeProvider Time { get; }
    public AuthSettings Settings { get; }
    public PooledDbContextFactory<ComplyDbContext> Factory { get; }
    public ComplyDatabase Database { get; }
    public AuthTokenService Tokens { get; }
    public UserDirectory Users { get; }
    public AuthService Auth { get; }
    public LibraryStore Store { get; }
    public AgentService Agent { get; }
    public McpKeyService Keys { get; }
    public TenantContext Tenant { get; }
    public AgentApi McpApi { get; }
    public ContentApi Api { get; }

    /// <summary>Registers the first organization and returns its session token.</summary>
    public async Task<SessionResult> RegisterAsync(string organizationName = "Nordwind")
    {
        var session = await Auth.RegisterAsync(
            new RegisterRequest(NordwindEmail, "Ada", "correct horse battery", organizationName),
            CancellationToken.None);
        Session = session.Session;
        Organization = (await Users.FindByEmailAsync(NordwindEmail, CancellationToken.None))!.Organization!;
        return session;
    }

    /// <summary>Session bearer token of the registered user, once <see cref="RegisterAsync"/> ran.</summary>
    public string? Session { get; private set; }

    public Organization? Organization { get; private set; }

    public async Task<Organization> AddOrganizationAsync(string slug, string name = "Helios")
    {
        await using var context = await Factory.CreateDbContextAsync();
        var organization = new Organization
        {
            Id = $"org-{slug}",
            Name = name,
            Slug = slug,
            CreatedAt = Time.GetUtcNow().AddDays(1),
        };
        context.Organizations.Add(organization);
        await context.SaveChangesAsync();
        return organization;
    }

    public async Task<Organization> OrganizationAsync()
    {
        if (Organization is not null) return Organization;
        await RegisterAsync();
        return Organization!;
    }

    public async Task<Organization> OtherOrganizationAsync()
    {
        if (await Users.FindOrganizationBySlugAsync(OtherSlug, CancellationToken.None) is { } existing)
        {
            return existing;
        }

        return await AddOrganizationAsync(OtherSlug);
    }

    public Task<JsonObject> CallAsync(string tool, string json, Organization? organization = null) =>
        CallAsync(tool, ParseObject(json), organization);

    public async Task<JsonObject> CallAsync(string tool, JsonObject args, Organization? organization = null)
    {
        var target = organization ?? await OrganizationAsync();
        return await Agent.CallAsync(target.Id, tool, new ToolArguments(args));
    }

    public async Task<HttpResponseMessageLike> SendAsync(
        string path,
        string method = "GET",
        string? json = null,
        string? bearer = null,
        string? tenant = null,
        string? query = null,
        string? origin = null,
        string? cookie = null,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        var request = TestRequest.Build(path, method, json, bearer, query, origin, cookie, tenant, headers);
        var normalized = path.Split('?')[0].TrimEnd('/');
        var response = await Api.HandleAsync(request);
        return new HttpResponseMessageLike(response);
    }

    public static JsonObject ParseObject(string json) =>
        JsonNode.Parse(json) as JsonObject ?? throw new ArgumentException("Expected a JSON object.", nameof(json));

    public static string Json(object value) => System.Text.Json.JsonSerializer.Serialize(value);

    private string NextId() => $"{_ids++:x8}";

    private byte[] NextSecret()
    {
        var bytes = new byte[32];
        bytes[31] = (byte)++_secrets;
        return bytes;
    }

    private static ContentLibrary Library() => new()
    {
        Version = 1,
        Sources =
        [
            new SourceRecord { Id = "src-nis2-test", FrameworkId = "nis2", Title = "NIS2 (test)" },
            new SourceRecord { Id = "src-iso-test", FrameworkId = "iso27001", Title = "ISO 27001 (test)" },
        ],
        Requirements =
        [
            Requirement("req-nis2-risk", "src-nis2-test", "nis2", "Art. 21(2)(a)", "Risk analysis policy",
                "Approved risk analysis policies and information security risk assessments are reviewed annually.",
                "governance", "published"),
            Requirement("req-nis2-incident", "src-nis2-test", "nis2", "Art. 21(2)(b)", "Incident handling",
                "Incident handling processes detect, report, and respond to security incidents.",
                "operations", "published"),
            Requirement("req-nis2-supply", "src-nis2-test", "nis2", "Art. 21(2)(d)", "Supply chain security",
                "Supply chain security covers suppliers and service providers in the registry.",
                "supply_chain", "published"),
            Requirement("req-nis2-training", "src-nis2-test", "nis2", "Art. 20", "Training",
                "Cyber hygiene training and awareness programmes run for all staff.",
                "people", "draft"),
            Requirement("req-nis2-crypto", "src-nis2-test", "nis2", "Art. 21(2)(h)", "Cryptography",
                "The cryptography policy covers encryption of data at rest and in transit.",
                "operations", "published"),
            Requirement("req-iso-a5", "src-iso-test", "iso27001", "A.5.1", "Policies for information security",
                "Information security policy and topic-specific policies are defined and approved.",
                "governance", "published"),
        ],
    };

    private static Requirement Requirement(
        string id,
        string sourceId,
        string frameworkId,
        string reference,
        string title,
        string text,
        string theme,
        string status) => new()
    {
        Id = id,
        SourceId = sourceId,
        FrameworkId = frameworkId,
        Ref = reference,
        Title = title,
        Text = text,
        Theme = theme,
        Status = status,
        CreatedAt = "2026-10-30T00:00:00.000Z",
    };

    public void Dispose()
    {
        _workspace.Dispose();
        using var context = Factory.CreateDbContext();
        context.Database.EnsureDeleted();
    }
}

/// <summary>Thin wrapper exposing the parts of an HTTP response the tests assert on.</summary>
internal sealed record HttpResponseMessageLike(ApiResponse Response)
{
    public int Status => Response.Status;

    public IReadOnlyDictionary<string, string>? Headers => Response.Headers;

    public JsonNode? Body => Response.Body is null
        ? null
        : JsonNode.Parse(Encoding.UTF8.GetString(
            System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(
                Response.Body,
                Response.Body.GetType(),
                Comply.Functions.Json.JsonDefaults.Serializer)));
}
