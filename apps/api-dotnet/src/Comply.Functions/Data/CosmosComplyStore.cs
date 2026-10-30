using System.Globalization;
using System.Net;
using System.Text;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Comply.Functions.Data;

/// <summary>
/// Cosmos DB (NoSQL, serverless) persistence for the .NET host. Each aggregate is one document:
/// assessments embed their requirements, evidence and events, which keeps the agent's read/write
/// path to a single point read and a single replace.
/// </summary>
public sealed class CosmosComplyStore : IComplyStore
{
    private const string Organizations = "organizations";
    private const string Users = "users";
    private const string EmailLocks = "email_locks";
    private const string ExternalLogins = "external_logins";
    private const string Assessments = "assessments";
    private const string McpKeys = "mcp_keys";

    private readonly Container _organizations;
    private readonly Container _users;
    private readonly Container _emailLocks;
    private readonly Container _externalLogins;
    private readonly Container _assessments;
    private readonly Container _mcpKeys;
    private readonly ILogger _logger;

    private CosmosComplyStore(
        Container organizations,
        Container users,
        Container emailLocks,
        Container externalLogins,
        Container assessments,
        Container mcpKeys,
        ILogger logger)
    {
        _organizations = organizations;
        _users = users;
        _emailLocks = emailLocks;
        _externalLogins = externalLogins;
        _assessments = assessments;
        _mcpKeys = mcpKeys;
        _logger = logger;
    }

    public bool IsConfigured => true;

    public static async Task<CosmosComplyStore> CreateAsync(
        CosmosSettings settings,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        if (!settings.IsConfigured)
        {
            throw new InvalidOperationException(
                $"Set {CosmosSettings.ConnectionVariable} to use Cosmos DB.");
        }

        var client = new CosmosClient(settings.ConnectionString, new CosmosClientOptions
        {
            ConnectionMode = ConnectionMode.Gateway,
            Serializer = new CosmosJsonSerializer(),
            ServerCertificateCustomValidationCallback = settings.AllowEmulatorCertificate
                ? (_, _, _) => true
                : null,
        });

        var database = client.GetDatabase(settings.Database);
        logger.LogInformation("Using Cosmos DB at {Target}.", settings.DescribeTarget());

        if (settings.CreateContainers)
        {
            await client.CreateDatabaseIfNotExistsAsync(settings.Database, cancellationToken: cancellationToken);
            await EnsureContainerAsync(database, Organizations, "/id", logger, cancellationToken);
            await EnsureContainerAsync(database, Users, "/id", logger, cancellationToken);
            await EnsureContainerAsync(database, EmailLocks, "/id", logger, cancellationToken);
            await EnsureContainerAsync(database, ExternalLogins, "/id", logger, cancellationToken);
            await EnsureContainerAsync(database, Assessments, "/organizationId", logger, cancellationToken);
            await EnsureContainerAsync(database, McpKeys, "/organizationId", logger, cancellationToken);
        }

        return new CosmosComplyStore(
            database.GetContainer(Organizations),
            database.GetContainer(Users),
            database.GetContainer(EmailLocks),
            database.GetContainer(ExternalLogins),
            database.GetContainer(Assessments),
            database.GetContainer(McpKeys),
            logger);
    }

    public async Task<int> CountUsersAsync(CancellationToken cancellationToken = default)
    {
        var query = new QueryDefinition("SELECT VALUE COUNT(1) FROM c");
        var iterator = _users.GetItemQueryIterator<int>(query);
        var count = 0;
        while (iterator.HasMoreResults)
        {
            foreach (var value in await iterator.ReadNextAsync(cancellationToken))
            {
                count += value;
            }
        }

        return count;
    }

    public async Task<bool> UserEmailExistsAsync(
        string email,
        CancellationToken cancellationToken = default) =>
        await ReadEmailLockAsync(email, cancellationToken) is not null;

    public async Task<User?> FindUserByEmailAsync(
        string email,
        CancellationToken cancellationToken = default)
    {
        var lockDocument = await ReadEmailLockAsync(email, cancellationToken);
        if (lockDocument is null) return null;

        var user = await ReadAsync<User>(_users, lockDocument.UserId, new PartitionKey(lockDocument.UserId), cancellationToken);
        return await WithOrganizationAsync(user, cancellationToken);
    }

    public async Task<User?> FindUserByIdAsync(
        string id,
        CancellationToken cancellationToken = default)
    {
        var user = await ReadAsync<User>(_users, id, new PartitionKey(id), cancellationToken);
        return await WithOrganizationAsync(user, cancellationToken);
    }

    public async Task AddUserAsync(User user, CancellationToken cancellationToken = default)
    {
        var email = user.Email.ToLowerInvariant();
        try
        {
            await _emailLocks.CreateItemAsync(
                new EmailLock { Id = email, UserId = user.Id },
                new PartitionKey(email),
                cancellationToken: cancellationToken);
        }
        catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.Conflict)
        {
            throw new StoreConflictException($"A user with {user.Email} already exists.");
        }

        try
        {
            await _users.CreateItemAsync(user, new PartitionKey(user.Id), cancellationToken: cancellationToken);
        }
        catch
        {
            await DeleteAsync(_emailLocks, email, new PartitionKey(email), CancellationToken.None);
            throw;
        }
    }

    public async Task SaveUserAsync(User user, CancellationToken cancellationToken = default)
    {
        await _users.ReplaceItemAsync(
            user,
            user.Id,
            new PartitionKey(user.Id),
            cancellationToken: cancellationToken);
    }

    public async Task<bool> ExternalLoginExistsAsync(
        string provider,
        string subject,
        CancellationToken cancellationToken = default)
    {
        var id = UserDirectory.ExternalLoginId(provider, subject);
        var login = await ReadAsync<ExternalLogin>(
            _externalLogins,
            id,
            new PartitionKey(id),
            cancellationToken);
        return login is not null;
    }

    public async Task AddExternalLoginAsync(
        ExternalLogin login,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await _externalLogins.CreateItemAsync(
                login,
                new PartitionKey(login.Id),
                cancellationToken: cancellationToken);
        }
        catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.Conflict)
        {
            throw new StoreConflictException("The external login is already linked.");
        }
    }

    public async Task<Organization?> FindOrganizationBySlugAsync(
        string slug,
        CancellationToken cancellationToken = default)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.slug = @slug")
            .WithParameter("@slug", slug);
        return await FirstAsync<Organization>(_organizations, query, cancellationToken);
    }

    public async Task<Organization?> FindOrganizationByIdAsync(
        string id,
        CancellationToken cancellationToken = default) =>
        await ReadAsync<Organization>(_organizations, id, new PartitionKey(id), cancellationToken);

    public async Task<Organization?> FirstOrganizationAsync(CancellationToken cancellationToken = default)
    {
        var organizations = await QueryAsync<Organization>(
            _organizations,
            new QueryDefinition("SELECT * FROM c"),
            cancellationToken);
        return organizations.OrderBy(organization => organization.CreatedAt).FirstOrDefault();
    }

    public async Task<bool> OrganizationSlugExistsAsync(
        string slug,
        CancellationToken cancellationToken = default) =>
        await FirstAsync<Organization>(
            _organizations,
            new QueryDefinition("SELECT * FROM c WHERE c.slug = @slug").WithParameter("@slug", slug),
            cancellationToken) is not null;

    public async Task AddOrganizationAsync(
        Organization organization,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await _organizations.CreateItemAsync(
                organization,
                new PartitionKey(organization.Id),
                cancellationToken: cancellationToken);
        }
        catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.Conflict)
        {
            throw new StoreConflictException($"The organization slug {organization.Slug} is taken.");
        }
    }

    public async Task AddAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default)
    {
        await _assessments.CreateItemAsync(
            assessment,
            new PartitionKey(assessment.OrganizationId),
            cancellationToken: cancellationToken);
    }

    public async Task<Assessment?> GetAssessmentAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default) =>
        await ReadAsync<Assessment>(
            _assessments,
            id,
            new PartitionKey(organizationId),
            cancellationToken);

    public async Task<IReadOnlyList<Assessment>> ListAssessmentsAsync(
        string organizationId,
        CancellationToken cancellationToken = default) =>
        await QueryAsync<Assessment>(
            _assessments,
            new QueryDefinition("SELECT * FROM c WHERE c.organizationId = @organizationId")
                .WithParameter("@organizationId", organizationId),
            cancellationToken,
            new PartitionKey(organizationId));

    public async Task SaveAssessmentAsync(
        Assessment assessment,
        CancellationToken cancellationToken = default)
    {
        await _assessments.ReplaceItemAsync(
            assessment,
            assessment.Id,
            new PartitionKey(assessment.OrganizationId),
            cancellationToken: cancellationToken);
    }

    public async Task<IReadOnlyList<McpKey>> ListMcpKeysAsync(
        string organizationId,
        CancellationToken cancellationToken = default) =>
        await QueryAsync<McpKey>(
            _mcpKeys,
            new QueryDefinition("SELECT * FROM c WHERE c.organizationId = @organizationId")
                .WithParameter("@organizationId", organizationId),
            cancellationToken,
            new PartitionKey(organizationId));

    public async Task<McpKey?> FindMcpKeyByIdAsync(
        string organizationId,
        string id,
        CancellationToken cancellationToken = default) =>
        await ReadAsync<McpKey>(_mcpKeys, id, new PartitionKey(organizationId), cancellationToken);

    public async Task<McpKey?> FindMcpKeyByHashAsync(
        string hash,
        CancellationToken cancellationToken = default) =>
        await FirstAsync<McpKey>(
            _mcpKeys,
            new QueryDefinition("SELECT * FROM c WHERE c.keyHash = @hash").WithParameter("@hash", hash),
            cancellationToken);

    public async Task AddMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default)
    {
        await _mcpKeys.CreateItemAsync(
            key,
            new PartitionKey(key.OrganizationId),
            cancellationToken: cancellationToken);
    }

    public async Task SaveMcpKeyAsync(McpKey key, CancellationToken cancellationToken = default)
    {
        await _mcpKeys.ReplaceItemAsync(
            key,
            key.Id,
            new PartitionKey(key.OrganizationId),
            cancellationToken: cancellationToken);
    }

    private async Task<User?> WithOrganizationAsync(User? user, CancellationToken cancellationToken)
    {
        if (user is null) return null;
        user.Organization = await FindOrganizationByIdAsync(user.OrganizationId, cancellationToken);
        return user;
    }

    private async Task<EmailLock?> ReadEmailLockAsync(string email, CancellationToken cancellationToken)
    {
        var id = email.ToLowerInvariant();
        return await ReadAsync<EmailLock>(_emailLocks, id, new PartitionKey(id), cancellationToken);
    }

    private static async Task<T?> ReadAsync<T>(
        Container container,
        string id,
        PartitionKey partitionKey,
        CancellationToken cancellationToken)
        where T : class
    {
        try
        {
            var response = await container.ReadItemAsync<T>(id, partitionKey, cancellationToken: cancellationToken);
            return response.Resource;
        }
        catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    private static async Task<T?> FirstAsync<T>(
        Container container,
        QueryDefinition query,
        CancellationToken cancellationToken)
        where T : class
    {
        var items = await QueryAsync<T>(container, query, cancellationToken);
        return items.FirstOrDefault();
    }

    private static async Task<List<T>> QueryAsync<T>(
        Container container,
        QueryDefinition query,
        CancellationToken cancellationToken,
        PartitionKey? partitionKey = null)
    {
        var options = partitionKey is null ? null : new QueryRequestOptions { PartitionKey = partitionKey };
        var iterator = container.GetItemQueryIterator<T>(query, requestOptions: options);
        var items = new List<T>();
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(cancellationToken);
            items.AddRange(page);
        }

        return items;
    }

    private static async Task DeleteAsync(
        Container container,
        string id,
        PartitionKey partitionKey,
        CancellationToken cancellationToken)
    {
        try
        {
            await container.DeleteItemAsync<object>(id, partitionKey, cancellationToken: cancellationToken);
        }
        catch (CosmosException)
        {
            // Best effort: a failed cleanup must not hide the original write error.
        }
    }

    private static async Task EnsureContainerAsync(
        Database database,
        string name,
        string partitionKeyPath,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        try
        {
            await database.CreateContainerIfNotExistsAsync(
                new ContainerProperties(name, partitionKeyPath),
                cancellationToken: cancellationToken);
        }
        catch (CosmosException exception) when (exception.StatusCode == HttpStatusCode.Forbidden)
        {
            logger.LogWarning(
                "Cosmos DB did not allow creating the {Container} container; assuming it is provisioned.",
                name);
        }
    }

    private sealed class EmailLock
    {
        [JsonProperty("id")] public string Id { get; set; } = "";
        [JsonProperty("userId")] public string UserId { get; set; } = "";
    }
}

/// <summary>Newtonsoft serializer with camelCase names and a stable <see cref="DateOnly"/> format.</summary>
internal sealed class CosmosJsonSerializer : CosmosSerializer
{
    private static readonly JsonSerializerSettings Settings = new()
    {
        ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver(),
        DateParseHandling = DateParseHandling.None,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new DateOnlyConverter() },
    };

    public override T FromStream<T>(Stream stream)
    {
        // The SDK requires the serializer to dispose the response stream.
        using var reader = new StreamReader(stream, Encoding.UTF8);
        using var json = new JsonTextReader(reader) { DateParseHandling = DateParseHandling.None };
        return JsonSerializer.Create(Settings).Deserialize<T>(json)
            ?? throw new JsonSerializationException("The Cosmos document was empty.");
    }

    public override Stream ToStream<T>(T input)
    {
        var stream = new MemoryStream();
        using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 1024, leaveOpen: true))
        using (var json = new JsonTextWriter(writer))
        {
            JsonSerializer.Create(Settings).Serialize(json, input);
        }

        stream.Position = 0;
        return stream;
    }

    private sealed class DateOnlyConverter : JsonConverter<DateOnly>
    {
        public override void WriteJson(JsonWriter writer, DateOnly value, JsonSerializer serializer) =>
            writer.WriteValue(value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));

        public override DateOnly ReadJson(
            JsonReader reader,
            Type objectType,
            DateOnly existingValue,
            bool hasExistingValue,
            JsonSerializer serializer) =>
            DateOnly.ParseExact(
                reader.Value?.ToString() ?? "",
                "yyyy-MM-dd",
                CultureInfo.InvariantCulture);
    }
}
