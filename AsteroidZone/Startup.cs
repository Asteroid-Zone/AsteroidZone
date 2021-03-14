using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Google.Cloud.Speech.V1;
using Microsoft.AspNetCore.Http;

namespace AsteroidZone
{
    public class Startup
    {
        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddRazorPages();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }
            else
            {
                app.UseExceptionHandler("/Error");
                // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
                app.UseHsts();
            }

            app.UseHttpsRedirection();
            app.UseStaticFiles(new StaticFileOptions
            {
                ServeUnknownFileTypes = true,
                DefaultContentType = "text/plain"
            });

            app.UseRouting();
            app.UseWebSockets();
            app.Use(async (context, next) =>
            {
                if (context.Request.Path == "/ws")
                {
                    if (context.WebSockets.IsWebSocketRequest)
                    {
                        using (WebSocket webSocket = await context.WebSockets.AcceptWebSocketAsync())
                        {
                            await GoogleCloudVoiceRec(context, webSocket);
                        }
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                    }
                }
                else
                {
                    await next();
                }

            });

            app.UseAuthorization();

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapRazorPages();
            });
        }

        private static async Task GoogleCloudVoiceRec(HttpContext context, WebSocket webSocket)
        {
            try
            {
                // Create a speech client using the credentials
                var speechBuilder = new SpeechClientBuilder { CredentialsPath = ".\\key.json" };
                var speech = speechBuilder.Build();
                var streamingCall = speech.StreamingRecognize();

                // Write the initial request with the config.
                await streamingCall.WriteAsync(
                    new StreamingRecognizeRequest()
                    {
                        StreamingConfig = new StreamingRecognitionConfig()
                        {
                            Config = new RecognitionConfig()
                            {
                                Encoding = RecognitionConfig.Types.AudioEncoding.Linear16,
                                SampleRateHertz = 44100,
                                LanguageCode = "en",
                                AudioChannelCount = 1
                            },
                            InterimResults = true
                        }
                    });

                // Print responses as they arrive.
                Task printResponses = Task.Run(async () =>
                {
                    var responseStream = streamingCall.GetResponseStream();
                    while (await responseStream.MoveNextAsync())
                    {
                        StreamingRecognizeResponse response = responseStream.Current;
                        foreach (StreamingRecognitionResult result in response.Results)
                        {
                            foreach (SpeechRecognitionAlternative alternative in result.Alternatives)
                            {
                                // Print the result on the console and send back via the websocket
                                await SendStringToSocket(webSocket, alternative.Transcript, CancellationToken.None);
                            }
                        }
                    }
                });

                // Create a buffer which will be used to 
                var buffer = new byte[32 * 1024];

                WebSocketReceiveResult socketResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                while (!socketResult.CloseStatus.HasValue)
                {
                    await streamingCall.WriteAsync(
                        new StreamingRecognizeRequest
                        {
                            AudioContent = Google.Protobuf.ByteString.CopyFrom(buffer, 0, socketResult.Count)
                        });

                    socketResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                }

                // Complete the recognition stream
                await streamingCall.WriteCompleteAsync();

                // Wait for the responses to be sent via the socket
                await printResponses;

                // Close the socket when all of the data has been taken
                await webSocket.CloseAsync(socketResult.CloseStatus.Value, socketResult.CloseStatusDescription, CancellationToken.None);
            }
            catch (Exception ex)
            {
                Console.WriteLine(ex.Message);
            }
        }

        private static Task SendStringToSocket(WebSocket ws, string data, CancellationToken cancellation)
        {
            var encoded = Encoding.UTF8.GetBytes(data);
            var buffer = new ArraySegment<byte>(encoded, 0, encoded.Length);
            return ws.SendAsync(buffer, WebSocketMessageType.Text, true, cancellation);
        }
    }
}
