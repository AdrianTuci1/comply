using System.Text.Encodings.Web;
using System.Text.Json;

namespace Comply.Functions.Json;

public static class JsonDefaults
{
    /// <summary>
    /// Web defaults give camelCase names and case-insensitive reads. Relaxed escaping keeps
    /// non-ASCII content readable, matching the UTF-8 output of the Node API.
    /// </summary>
    public static JsonSerializerOptions Serializer { get; } = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };
}
