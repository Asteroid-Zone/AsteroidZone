using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
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
            services.AddResponseCompression();
            services.AddRazorPages();
        }

        // This method gets called by the runtime. Use this method to configure the HTTP request pipeline.
        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            app.UseResponseCompression();
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
                var speechBuilder = new SpeechClientBuilder { JsonCredentials = Credentials };
                var speech = speechBuilder.Build();
                var streamingCall = speech.StreamingRecognize();

                // Write the initial request with the config.
                var speechContext = new SpeechContext
                {
                    Phrases = { Phrases }
                };
                var speechConfig = new RecognitionConfig
                {
                    Encoding = RecognitionConfig.Types.AudioEncoding.Linear16,
                    SampleRateHertz = 16000,
                    AudioChannelCount = 1,
                    LanguageCode = "en",
                    SpeechContexts = { speechContext }
                };

                await streamingCall.WriteAsync(
                    new StreamingRecognizeRequest
                    {
                        StreamingConfig = new StreamingRecognitionConfig
                        {
                            Config = speechConfig,
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
                var buffer = new byte[128 * 1024];

                WebSocketReceiveResult socketResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                while (!socketResult.CloseStatus.HasValue)
                {
                    streamingCall.WriteAsync(
                        new StreamingRecognizeRequest
                        {
                            AudioContent = Google.Protobuf.ByteString.CopyFrom(buffer, 0, socketResult.Count)
                        }).Wait();

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

        private const string Credentials = @"{
          ""type"": ""service_account"",
          ""project_id"": ""asteroidzone"",
          ""private_key_id"": ""e264a3e5a1310d94cb082087c4a3891c733d11c5"",
          ""private_key"": ""-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCJoXq1u9IrjLIo\nBjow9lefYsdlGVYB2a4DyasTbTSxx4/SUd1SfpCBRfF6hQwfIO9XeANR2Adva9jw\nirlxf2mAGzyAgRXR2Vu6b9Yl3byqHleH9DAKlXDFF8IV9shV5NUZrtbHqyM9pNJS\nJXgpJowTFqJAAxG/3l6sAybx3gkJbGcY5u1MC8tEVTalD0y7xJUxgdp7qmG6Qmkf\nir8YTpOse8l7x+AfUoD+Os4h95jYmZNMwDlV+yxW5sPD5vlZgdbxMvmoVImwGBHm\nP5Vzvn3FsSHG2C1WcJDmMDOZKMov94uvqNqu41Cz0UEBAEAzezQ4AOLRvSV2pIIN\niqOVz2qLAgMBAAECggEALYqnhjdORmbaFPBqlQUO3YjcHhISKa6ULGCxIU6Dn0g/\nyQKZz9BdlMlGLJqV9j75s+Hch1qKq03ujTn6PxpAGMnqbUNJqxTXi4uyOvlykoBT\nyoL82qO0myNPb+EnTXTZJxR5sbxpft5pUhFf/43nz/EvYysg1nKItTadzm8AYoNm\nJGrWSq7md1NPXwI8WGLQ2/HFXKwzuZSzw4UV/QiV04UxQTPKbw+aXZF7NiDH6Gen\nUSfBYSWTnfN2jL3wt/dCoarNJZE3OX71VMd9jrRNL3FxxbCtitK/oxBDbgnxO1M+\nwh7kzN8VF9uRs3FmE4OfMTmAfY1hKBvPdGdLh3DisQKBgQC+xcy9XNtNhVajaFqy\n300Rbe30UFB6JG/9ksHfp72ix0jshwkKj7/G/JqXVP1GOHrQ7he/o1WVldjLERiK\nWZyqtecioI50tj/wR+OJ7ybhYnpv0oq5oR3JwTOvXDQWR0txYJE7I6rriWUHxwSt\nKeek9H61MHugoBr1FhKrojXIDQKBgQC4sDUYDAbCYHa9hLIzUSHeG/0WqI7/hy3M\nInXLy4cP3re0rFiDmfwOZa+BArauN5ThwthTcIE4jpaAHw0TlXyNF151WkkPKNlZ\naVKMx1y0u2+Ib1/mdRPycmdeRSflr9CCCKssSLaQ2y5G4nLVKEvTM9LPCXh/XdtQ\n8sLuHwl+9wKBgEJKT2O5wYbFf56Wo3WmfIxC673KrrxSrwupFG9YRWAr6Z4vKige\nXWCS5FETulLNS3gQU/ZGlnW9NTETBrkEfJkhTmjM69OIhN1Ezb9fd943rx3uRkBM\nySITXZdg7cSUD5YdHTo0oa7o9k9mi6x0dEbwoprpdvwQxm1Ft0Umv5N9AoGAHBUG\n7bIecP3T8Ds2EWF7wdcFo6VboPT//LMcsDExRzN5QWqXRuNqFRJXHkm4V0MySyWi\nWQWZUG016yNNjLXFK3rrLPLeewSeD99Y4vkJWp3Jdrhgn50bvFiy6P2g9GbIUI1a\n4a/oupvpLHQQO+MVrHaLzllFTjCKQYO4KhbkDb8CgYANQ0bRC/L47TV4nH+ummWG\nPLYtf7IClQqbLyvRSbw0uIidv7fE4zTcn1xwCTDFbsPnh7L6AniIFHeEVAgNTecK\ny/NwYpR+c4pi7HLi/m7hmFjo2bxjELs+afZo+xZo0Hb1YR0lgNDgUW8j3BH76dwA\nHOKz6l8ixG07A3XP7ORsSw==\n-----END PRIVATE KEY-----\n"",
          ""client_email"": ""my-speech-to-text-sa@asteroidzone.iam.gserviceaccount.com"",
          ""client_id"": ""107057819689325340513"",
          ""auth_uri"": ""https://accounts.google.com/o/oauth2/auth"",
          ""token_uri"": ""https://oauth2.googleapis.com/token"",
          ""auth_provider_x509_cert_url"": ""https://www.googleapis.com/oauth2/v1/certs"",
          ""client_x509_cert_url"": ""https://www.googleapis.com/robot/v1/metadata/x509/my-speech-to-text-sa%40asteroidzone.iam.gserviceaccount.com""
        }";

        public static readonly List<string> Phrases = new List<string>
        {
            "north",
            "south",
            "east",
            "west",
            "go",
            "move"
        };
    }
}
