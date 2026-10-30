namespace Comply.Functions.Api;

/// <summary>
/// Deployment-facing settings read from the environment, mirroring the Node runtime endpoint.
/// </summary>
public sealed record DeploymentSettings(
    string? DeploymentMode,
    string? PublicUrl,
    string? TrustHost,
    string? TrustSlug)
{
    public static DeploymentSettings FromEnvironment() => new(
        DeploymentMode: Environment.GetEnvironmentVariable("COMPLY_DEPLOYMENT_MODE"),
        PublicUrl: Environment.GetEnvironmentVariable("COMPLY_PUBLIC_URL"),
        TrustHost: Environment.GetEnvironmentVariable("COMPLY_TRUST_HOST"),
        TrustSlug: Environment.GetEnvironmentVariable("COMPLY_TRUST_SLUG"));
}
