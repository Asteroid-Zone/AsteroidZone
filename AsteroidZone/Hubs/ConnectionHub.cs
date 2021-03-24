using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;

namespace AsteroidZone.Hubs
{
    public class ConnectionHub : Hub<IConnectionHub>
    {
        private static readonly Dictionary<string, List<string>> Channels = new Dictionary<string, List<string>>();

        public override async Task OnDisconnectedAsync(Exception exception)
        {
            List<List<string>> channelsWithUser = Channels.Values.Where(v => v.Contains(Context.ConnectionId)).ToList();
            foreach (string channelName in Channels.Keys.Where(channelName => channelsWithUser.Contains(Channels[channelName])))
            {
                await LeaveChat(channelName);
            }

            await base.OnDisconnectedAsync(exception);
        }

        public async Task JoinChat(string channelName)
        {
            List<string> channelUsers;
            if (!Channels.ContainsKey(channelName))
            {
                channelUsers = new List<string>();
                Channels.Add(channelName, channelUsers);
            }
            else
            {
                channelUsers = Channels[channelName];
            }

            var callingUserConId = Context.ConnectionId;

            await Clients.Others.AddToCall(callingUserConId, false);

            foreach (string channelUser in channelUsers)
            {
                await Clients.Caller.AddToCall(channelUser, true);
            }

            channelUsers.Add(callingUserConId);
        }

        public async Task LeaveChat(string channelName)
        {
            var callingUserConId = Context.ConnectionId;

            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            var channelUsers = Channels[channelName];
            channelUsers.Remove(callingUserConId);

            if (channelUsers.Count == 0)
            {
                Channels.Remove(channelName);
            }

            await Clients.Others.RemoveFromCall(callingUserConId);
            foreach (string channelUser in channelUsers.Where(channelUser => channelUser != callingUserConId))
            {
                await Clients.Caller.RemoveFromCall(channelUser);
            }
        }

        public async Task RelaySessionDescription(string channelName, string addedUserConId, object sessionDescription)
        {
            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            if (Channels[channelName].Contains(addedUserConId))
            {
                await Clients.Client(addedUserConId).SessionDescription(Context.ConnectionId, sessionDescription);
            }
        }

        public async Task RelayIceCandidate(string channelName, string peerId, object iceCandidate)
        {
            if (!Channels.ContainsKey(channelName))
            {
                return;
            }

            if (Channels[channelName].Contains(peerId))
            {
                await Clients.Client(peerId).IceCandidate(Context.ConnectionId, iceCandidate);
            }
        }
    }

    public interface IConnectionHub
    {
        Task AddToCall(string connectionId, bool createOffer);
        Task RemoveFromCall(string connectionId);
        Task SessionDescription(string connectionId, object sessionDescription);
        Task IceCandidate(string connectionId, object iceCandidate);
    }
}