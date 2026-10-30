using Comply.Functions.Models;

namespace Comply.Functions.Api;

/// <summary>
/// Transport-neutral response: the trigger adapter turns this into an HTTP result so the
/// routing logic stays testable without the Functions host.
/// </summary>
public sealed record ApiResponse(int Status, object? Body, IReadOnlyDictionary<string, string>? Headers = null)
{
    public static ApiResponse Ok(object body) => new(200, body);

    public static ApiResponse Created(object body, IReadOnlyDictionary<string, string>? headers = null) =>
        new(201, body, headers);

    public static ApiResponse NoContent(IReadOnlyDictionary<string, string>? headers = null) =>
        new(204, null, headers);

    public static ApiResponse Redirect(string location) =>
        new(302, null, new Dictionary<string, string> { ["Location"] = location });

    public static ApiResponse Error(int status, string error, string? code = null) =>
        new(status, new ErrorBody(error, code));

    public static ApiResponse MethodNotAllowed() =>
        new(405, new ErrorBody("Method not allowed."), new Dictionary<string, string>
        {
            ["Allow"] = "GET, OPTIONS",
        });
}
