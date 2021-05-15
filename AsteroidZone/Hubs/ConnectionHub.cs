using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

namespace AsteroidZone.Hubs
{
    public class ConnectionHub : Hub<IConnectionHub>
    {
        private static readonly ConcurrentDictionary<string, List<string>> Channels =
            new ConcurrentDictionary<string, List<string>>();

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            // Make the user leave each chat where it is part of
            Channels.Where(kvp => kvp.Value.Contains(Context.ConnectionId)) // Get all channels containing the user
                .Select(kvp => kvp.Key) // Convert to channel names
                .ToList()
                .ForEach(async channelWithUser => await LeaveChat(channelWithUser)); // Leave each chat

            await base.OnDisconnectedAsync(exception);
        }

        public async Task JoinChat(string channelName)
        {
            List<string> channelUsers;

            // Check if channel is already created
            if (!Channels.ContainsKey(channelName))
            {
                // Create the new channel and add to the channels dictionary
                channelUsers = new List<string>();
                Channels[channelName] = channelUsers;
            }
            else
            {
                // Get the already created channel
                channelUsers = Channels[channelName];
            }

            // Get the id of the calling user
            var callingUserConId = Context.ConnectionId;

            // Check if user is not already in the channel
            if (channelUsers.Contains(callingUserConId))
            {
                return;
            }

            // Make all other users in the channel group call the user
            await Clients.Clients(Channels[channelName]).AddToCall(callingUserConId, false);

            // Make the user add all the other users in the channel
            foreach (string channelUser in channelUsers)
            {
                await Clients.Caller.AddToCall(channelUser, true);
            }

            // Add the user to the channel
            channelUsers.Add(callingUserConId);
        }

        public async Task LeaveChat(string channelName)
        {
            // Get the connection ID of the calling user
            var callingUserConId = Context.ConnectionId;

            // Check if channel is contained in the dictionary
            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            // Get the list of users in the channel
            var channelUsers = Channels[channelName];

            // Remove the current user from the channel list
            channelUsers.Remove(callingUserConId);

            // Check if user was the last one in the channel and if so remove the channel
            if (channelUsers.Count == 0)
            {
                Channels.TryRemove(channelName, out _);
                return;
            }

            // Make the users in the channel remove the 'leaver'
            await Clients.Clients(channelUsers).RemoveFromCall(callingUserConId);

            // Make the 'leaver' remove all the rest from the channel from the call
            foreach (string channelUser in channelUsers)
            {
                await Clients.Caller.RemoveFromCall(channelUser);
            }
        }

        public async Task RelaySessionDescription(string channelName, string addedUserConId, object sessionDescription)
        {
            // Check channel is contained in the dictionary
            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            // Check the channel contains the user to be added
            if (Channels[channelName].Contains(addedUserConId))
            {
                // Make the user perform the action
                await Clients.Client(addedUserConId).SessionDescription(Context.ConnectionId, sessionDescription);
            }
        }

        public async Task RelayIceCandidate(string channelName, string peerId, object iceCandidate)
        {
            // Check the channel is contained in the dictionary
            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            // Check the channel contains the user to be added
            if (Channels[channelName].Contains(peerId))
            {
                // Make the 'peer' call the ice candidate method
                await Clients.Client(peerId).IceCandidate(Context.ConnectionId, iceCandidate);
            }
        }
    }

    public interface IConnectionHub
    {
        /// <summary>
        /// Add the user with the specific connection ID to 'my' list of connection
        /// </summary>
        /// <param name="connectionId">peer to be added</param>
        /// <param name="createOffer">should I be the one to create the WebRTC offer</param>
        /// <returns>Async Task</returns>
        Task AddToCall(string connectionId, bool createOffer);

        /// <summary>
        /// Remove the user with the specific connection ID from 'my' list of connections
        /// </summary>
        /// <param name="connectionId">peer to be removed</param>
        /// <returns>Async Task</returns>
        Task RemoveFromCall(string connectionId);

        /// <summary>
        /// Provide session description from a peer
        /// </summary>
        /// <param name="connectionId">peer whose session description is being provided</param>
        /// <param name="sessionDescription">session description object</param>
        /// <returns>Async Task</returns>
        Task SessionDescription(string connectionId, object sessionDescription);

        /// <summary>
        /// Provide ICE candidate from a peer
        /// </summary>
        /// <param name="connectionId">peer whose ICE candidate is being provided</param>
        /// <param name="iceCandidate">ICE candidate object</param>
        /// <returns>Async Task</returns>
        Task IceCandidate(string connectionId, object iceCandidate);
    }
}