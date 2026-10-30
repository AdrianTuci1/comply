namespace Comply.Functions.Data;

/// <summary>
/// Cosmos DB configuration. A connection string enables accounts, assessments and MCP keys;
/// without it the content API still works and auth returns 503.
/// </summary>
public sealed record CosmosSettings(
    string? ConnectionString,
    string Database,
    bool CreateContainers,
    bool AllowEmulatorCertificate)
{
    public const string ConnectionVariable = "COMPLY_COSMOS_CONNECTION";
    public const string DatabaseVariable = "COMPLY_COSMOS_DATABASE";
    public const string CreateContainersVariable = "COMPLY_COSMOS_CREATE_CONTAINERS";
    public const string EmulatorVariable = "COMPLY_COSMOS_EMULATOR";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ConnectionString);

    public static CosmosSettings FromEnvironment() => Resolve(
        Environment.GetEnvironmentVariable(ConnectionVariable),
        Environment.GetEnvironmentVariable(DatabaseVariable),
        Environment.GetEnvironmentVariable(CreateContainersVariable),
        Environment.GetEnvironmentVariable(EmulatorVariable));

    public static CosmosSettings Resolve(
        string? connection,
        string? database,
        string? createContainers,
        string? emulator)
    {
        var trimmed = connection?.Trim();
        return new CosmosSettings(
            string.IsNullOrEmpty(trimmed) ? null : trimmed,
            string.IsNullOrWhiteSpace(database) ? "comply" : database.Trim(),
            createContainers?.Trim() != "0",
            emulator?.Trim() == "1" || IsLocalEndpoint(trimmed));
    }

    /// <summary>Endpoint host only, so logs never contain the account key.</summary>
    public string DescribeTarget()
    {
        if (!IsConfigured) return "not configured";
        foreach (var part in ConnectionString!.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = part.IndexOf('=');
            if (separator <= 0) continue;
            if (!part[..separator].Trim().Equals("AccountEndpoint", StringComparison.OrdinalIgnoreCase)) continue;
            return Uri.TryCreate(part[(separator + 1)..].Trim(), UriKind.Absolute, out var uri)
                ? $"{uri.Host}/{Database}"
                : $"configured/{Database}";
        }

        return $"configured/{Database}";
    }

    private static bool IsLocalEndpoint(string? connection)
    {
        if (string.IsNullOrWhiteSpace(connection)) return false;
        return connection.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || connection.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase)
            || connection.Contains("cosmos:8081", StringComparison.OrdinalIgnoreCase);
    }
}
