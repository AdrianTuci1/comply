namespace Comply.Functions.Agent;

/// <summary>
/// A tool failure the agent is expected to correct. <see cref="Code"/> is returned verbatim as
/// <c>structuredContent.error.code</c> and as the <c>code</c> member of the HTTP error body,
/// matching <c>AgentError</c> in <c>apps/api-node/lib/agent.mjs</c>.
/// </summary>
public sealed class AgentException(string message, string code = "invalid_request", object? details = null)
    : Exception(message)
{
    public string Code { get; } = code;

    public object? Details { get; } = details;

    /// <summary>The Node dispatcher reports every agent error as <c>400</c>.</summary>
    public int Status { get; } = 400;
}
