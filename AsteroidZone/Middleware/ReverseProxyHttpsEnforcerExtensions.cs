using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace AsteroidZone.Middleware
{
    public static class ReverseProxyHttpsEnforcerExtensions
    {
        public static IApplicationBuilder UseReverseProxyHttpsEnforcer(this IApplicationBuilder builder)
        {
            return builder.UseMiddleware<ReverseProxyHttpsEnforcer>();
        }
    }

    public class ReverseProxyHttpsEnforcer
    {
        private const string ForwardedProtoHeader = "X-Forwarded-Proto";
        private readonly RequestDelegate _next;

        public ReverseProxyHttpsEnforcer(RequestDelegate next)
        {
            _next = next;
        }

        /// <summary>
        /// Enforces HTTPS when opening the website
        /// </summary>
        /// <param name="ctx">HTTP context of the request</param>
        /// <returns>Async Task</returns>
        public async Task Invoke(HttpContext ctx)
        {
            // Check the headers and if the client is not using HTTPS, enforce it
            var h = ctx.Request.Headers;
            if (h[ForwardedProtoHeader] == string.Empty || h[ForwardedProtoHeader] == "https")
            {
                // Simply continue
                await _next(ctx);
            }
            else if (h[ForwardedProtoHeader] != "https")
            {
                // Get the URL with HTTPS and redirect to it
                var withHttps = $"https://{ctx.Request.Host}{ctx.Request.Path}{ctx.Request.QueryString}";
                ctx.Response.Redirect(withHttps);
            }
        }
    }
}
