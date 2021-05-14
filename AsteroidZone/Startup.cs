using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using AsteroidZone.Hubs;
using AsteroidZone.Middleware;
using Google.Cloud.Speech.V1;
using Microsoft.AspNetCore.Http;

namespace AsteroidZone
{
    public class Startup
    {
        /// <summary>
        /// Marker being appended to the final speech recognition result, before sending back to the client
        /// via the WebSocket.
        /// </summary>
        private const string SpeechRecFinalResultMarker = "<FINAL>";

        /// <summary>
        /// (LEGACY CHAT) List of sockets that should receive the bytes from the current user's microphone.
        /// </summary>
        private static readonly List<WebSocket> ChatSockets = new List<WebSocket>();

        public Startup(IConfiguration configuration)
        {
            Configuration = configuration;
        }

        public IConfiguration Configuration { get; }

        // This method gets called by the runtime. Use this method to add services to the container.
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddResponseCompression();

            // Razor pages are the technology used for visualising the HTML (they work by having a html with embedded C# code and code behind)
            services.AddRazorPages();

            // SignalR is a signalling server used for the WebRTC communication between users
            services.AddSignalR();
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
                app.UseReverseProxyHttpsEnforcer();
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
                // Web socket link for the voice recognition
                if (context.Request.Path == "/ws_vr")
                {
                    if (context.WebSockets.IsWebSocketRequest)
                    {
                        using (WebSocket webSocket = await context.WebSockets.AcceptWebSocketAsync())
                        {
                            // Start Google Cloud's voice recognition
                            await GoogleCloudVoiceRec(context, webSocket);
                        }
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                    }
                }

                // (LEGACY CHAT) Web socket link for the legacy voice chat (based on WebSockets)
                else if (context.Request.Path == "/ws_chat")
                {
                    if (context.WebSockets.IsWebSocketRequest)
                    {
                        using (WebSocket webSocket = await context.WebSockets.AcceptWebSocketAsync())
                        {
                            try
                            {
                                // Add the current socket to the list of sockets
                                ChatSockets.Add(webSocket);

                                // Start sending the bytes from the current client to the rest of the clients
                                await SendOthers(context, webSocket);
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine(ex.Message);
                            }
                            finally
                            {
                                // Remove the current user from the subscription list
                                ChatSockets.Remove(webSocket);
                            }
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

                // The connection hub is a signalling server (based on SignalR) used for real time functions execution between the client and the server
                endpoints.MapHub<ConnectionHub>("/ConnectionHub", options =>
                    {
                        // The signalling server will be based on web sockets for the Real Time communtcation
                        options.Transports = Microsoft.AspNetCore.Http.Connections.HttpTransportType.WebSockets;
                    });
            });
        }

        /// <summary>
        /// Sends the microphone raw bytes of the current client to the rest of the clients
        /// </summary>
        /// <param name="context">HTTP Context of the WebSocket connection</param>
        /// <param name="webSocket">Web Socket connection object</param>
        /// <returns>Task object as the method is asynchronous</returns>
        private static async Task SendOthers(HttpContext context, WebSocket webSocket)
        {
            // Create a buffer for fetching the microphone bytes
            var buffer = new byte[1024 * 4];

            // Receive the initial bytes
            WebSocketReceiveResult result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

            // Continue receiving bytes until a closing request is made
            while (!result.CloseStatus.HasValue)
            {
                // Send the bytes from the current client's microphone to the rest of the clients
                await SendOtherSocketsBytes(result, buffer, webSocket);

                // Receive new bytes
                result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            }

            // Close the Web Socket connection
            await webSocket.CloseAsync(result.CloseStatus.Value, result.CloseStatusDescription, CancellationToken.None);
        }

        /// <summary>
        /// Send the received bytes from one of the sockets to the rest of the sockets
        /// </summary>
        /// <param name="result">Socket received data object</param>
        /// <param name="buffer">buffer storing the received bytes</param>
        /// <param name="mySocket">The socket from which the data was received that should not receive its own bytes</param>
        /// <returns>Task object as the method is asynchronous</returns>
        private static async Task SendOtherSocketsBytes(WebSocketReceiveResult result, byte[] buffer, WebSocket mySocket)
        {
            // Send the bytes to all of the rest of the sockets except the socket of the current user
            foreach (var chatSocket in ChatSockets.Where(chatSocket => chatSocket != mySocket))
            {
                // Send the bytes asynchronously
                await chatSocket.SendAsync(new ArraySegment<byte>(buffer, 0, result.Count), result.MessageType, result.EndOfMessage, CancellationToken.None);
            }
        }

        /// <summary>
        /// Method used for testing sockets. Whatever it receives as bytes, it sends back to the socket
        /// </summary>
        /// <param name="context">HTTP Context of the WebSocket connection</param>
        /// <param name="webSocket">Web Socket connection object</param>
        /// <returns>Task object as the method is asynchronous</returns>
        private async Task Echo(HttpContext context, WebSocket webSocket)
        {
            // Create a buffer for fetching the microphone bytes
            var buffer = new byte[1024 * 4];

            // Receive the initial bytes
            WebSocketReceiveResult result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

            // Continue receiving bytes until a closing request is made
            while (!result.CloseStatus.HasValue)
            {
                // Send the bytes back to the socket (like an echo)
                await webSocket.SendAsync(new ArraySegment<byte>(buffer, 0, result.Count), result.MessageType, result.EndOfMessage, CancellationToken.None);

                // Receive new bytes
                result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
            }

            // Close the Web Socket connection
            await webSocket.CloseAsync(result.CloseStatus.Value, result.CloseStatusDescription, CancellationToken.None);
        }

        /// <summary>
        /// WebSocket handler method for the Google Cloud Voice Recognition API
        /// </summary>
        /// <param name="context">HTTP Context for the WebSocket connection</param>
        /// <param name="webSocket">WebSocket Connection object</param>
        /// <returns>Asynchronous method Task</returns>
        private static async Task GoogleCloudVoiceRec(HttpContext context, WebSocket webSocket)
        {
            try
            {
                // Create a speech client using the credentials
                var speechBuilder = new SpeechClientBuilder { JsonCredentials = Credentials };
                var speech = speechBuilder.Build();
                var streamingCall = speech.StreamingRecognize();

                // Add the Phrases list as grammar. Note: this functionality hasn't actually been implemented by Google, so it doesn't make any difference
                var speechContext = new SpeechContext
                {
                    Phrases = { Phrases }
                };

                // Write the initial request with the config.
                var speechConfig = new RecognitionConfig
                {
                    Encoding = RecognitionConfig.Types.AudioEncoding.Linear16,
                    SampleRateHertz = 44100,
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

                // Send back responses as they arrive.
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
                                // Send back the recognised phrases via the websocket and 
                                // if it is final put the necessary tag
                                if (result.IsFinal)
                                {
                                    await SendStringToSocket(webSocket, SpeechRecFinalResultMarker + alternative.Transcript, CancellationToken.None);
                                }
                                else
                                {
                                    await SendStringToSocket(webSocket, alternative.Transcript, CancellationToken.None);
                                }
                            }
                        }
                    }
                });

                // Create a buffer which will be used to 
                var buffer = new byte[128 * 1024];

                // Receive the bytes from the client's microphone
                WebSocketReceiveResult socketResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                // Continue receiving until a closing request is made
                while (!socketResult.CloseStatus.HasValue)
                {
                    // Write the received bytes to the streaming object
                    streamingCall.WriteAsync(
                        new StreamingRecognizeRequest
                        {
                            AudioContent = Google.Protobuf.ByteString.CopyFrom(buffer, 0, socketResult.Count)
                        }).Wait();

                    // Continue receiving bytes from the client's microphone
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

        /// <summary>
        /// Sends a string to a websocket
        /// </summary>
        /// <param name="ws">web socket connection object</param>
        /// <param name="data">string to be send</param>
        /// <param name="cancellation">cancellation token</param>
        /// <returns></returns>
        private static Task SendStringToSocket(WebSocket ws, string data, CancellationToken cancellation)
        {
            // Get the string bytes
            var encoded = Encoding.UTF8.GetBytes(data);

            // Add the bytes to a buffer
            var buffer = new ArraySegment<byte>(encoded, 0, encoded.Length);

            // Send the bytes buffer via the socket to the client
            return ws.SendAsync(buffer, WebSocketMessageType.Text, true, cancellation);
        }

        /// <summary>
        /// Credentials JSON used for connecting to Google Cloud's speech recognition services object.
        /// Note: a string is being used even though there is a key.json file, because the live version (Heroku.com) stores file differently,
        ///       so they could not be read from inside of the solution.
        /// </summary>
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

        /// <summary>
        /// Phrases used to create a grammar context for the voice recognition
        /// Note: Google's cloud speech recognition object does not really use this as it is not fully implemented by Google
        /// </summary>
        public static readonly List<string> Phrases = new List<string>
        {
            "north",
            "south",
            "east",
            "west",
            "go",
            "move",
            "left",
            "right"
        };
    }
}
