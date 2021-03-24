const hubUrl = document.location.pathname + 'ConnectionHub';
var wsconn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl, signalR.HttpTransportType.WebSockets)
    .configureLogging(signalR.LogLevel.None).build();

const USE_VIDEO = true;
const USE_AUDIO = true;
const MUTE_AUDIO_BY_DEFAULT = false;
let startingTrials = 0;

const ICE_SERVERS = [
    { url: 'stun:stun.l.google.com:19302' }
];

const GLOBAL_CHAT = 'GLOBAL_CHAT';

var local_media_stream = null; /* our own microphone / webcam */
var peers = {};                /* keep track of our peer connections, indexed by peer_id (aka socket.io id) */
var peer_media_elements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */

$(document).ready(function() {
    initializeSignalR();
});

const initializeSignalR = () => {
    wsconn.start().then(() => {
        console.log("SignalR: Connected");
        setup_local_media(function () {
            /* once the user has given us access to their
             * microphone/camcorder, join the channel and start peering up */
            wsconn.invoke('JoinChat', GLOBAL_CHAT);
        });
    }).catch(err => console.log(err));
};

wsconn.on('AddToCall', (peerId, createOffer) => {
    console.log('Signaling server said to add peer:', peerId, createOffer);
    if (peerId in peers) {
        /* This could happen if the user joins multiple channels where the other peer is also in. */
        console.log('Already connected to peer ', peerId);
        return;
    }

    var peerConnection = new RTCPeerConnection(
        { "iceServers": ICE_SERVERS },
        { "optional": [{ "DtlsSrtpKeyAgreement": true }] } /* this will no longer be needed by chrome
                                                            * eventually (supposedly), but is necessary 
                                                            * for now to get firefox to talk to chrome */
    );
    peers[peerId] = peerConnection;

    peerConnection.onicecandidate = function (event) {
        if (event.candidate) {
            wsconn.invoke('RelayIceCandidate', GLOBAL_CHAT, peerId, {
                'sdpMLineIndex': event.candidate.sdpMLineIndex,
                'candidate': event.candidate.candidate
            });
        }
    }

    peerConnection.onaddstream = function (event) {
        console.log('onAddStream', event);

        const remoteMedia = USE_VIDEO ? $('<video width="320" height="240" controls>') : $('<audio>');
        remoteMedia.attr('autoplay', 'autoplay');
        if (MUTE_AUDIO_BY_DEFAULT) {
            remoteMedia.attr('muted', 'true');
        } else {
            remoteMedia.removeAttr('muted');
        }
        peer_media_elements[peerId] = remoteMedia;
        $('body').append(remoteMedia);
        attachMediaStream(remoteMedia[0], event.stream);
    }

    /* Add our local stream */
    peerConnection.addStream(local_media_stream);

    /* Only one side of the peer connection should create the
     * offer, the signaling server picks one to be the offerer. 
     * The other user will get a 'sessionDescription' event and will
     * create an offer, then send back an answer 'sessionDescription' to us
     */
    if (createOffer) {
        console.log('Creating RTC offer to ', peerId);
        peerConnection.createOffer(
            function (localDescription) {
                console.log('Local offer description is: ', localDescription);
                peerConnection.setLocalDescription(localDescription,
                    function () {
                        wsconn.invoke('RelaySessionDescription', GLOBAL_CHAT, peerId, localDescription);
                        console.log('Offer setLocalDescription succeeded');
                    },
                    function () { Alert('Offer setLocalDescription failed!'); }
                );
            },
            function (error) {
                console.log('Error sending offer: ', error);
            });
    }
});

wsconn.on('RemoveFromCall', (peerId) => {
    console.log('Signaling server said to remove peer:', peerId);
    if (peerId in peer_media_elements) {
        peer_media_elements[peerId].remove();
    }
    if (peerId in peers) {
        peers[peerId].close();
    }

    delete peers[peerId];
    delete peer_media_elements[config.peer_id];
});

wsconn.on('SessionDescription', function (peerId, remoteDescription) {
    console.log('Remote description received: user: ', peerId, ' \nwith description: ', remoteDescription);
    var peer = peers[peerId];

    const desc = new RTCSessionDescription(remoteDescription);
    const stuff = peer.setRemoteDescription(desc,
        function () {
            console.log('setRemoteDescription succeeded');
            if (remoteDescription.type === 'offer') {
                console.log('Creating answer');
                peer.createAnswer(
                    function (localDescription) {
                        console.log('Answer description is: ', localDescription);
                        peer.setLocalDescription(localDescription,
                            function () {
                                wsconn.invoke('RelaySessionDescription', GLOBAL_CHAT, peerId, localDescription);
                                console.log('Answer setLocalDescription succeeded');
                            },
                            function () { Alert('Answer setLocalDescription failed!'); }
                        );
                    },
                    function (error) {
                        console.log('Error creating answer: ', error);
                        console.log(peer);
                    });
            }
        },
        function (error) {
            console.log('setRemoteDescription error: ', error);
        }
    );
    console.log('Description Object: ', desc);
});

wsconn.on('IceCandidate', function (peerId, iceCandidate) {
    const peer = peers[peerId];
    peer.addIceCandidate(new RTCIceCandidate(iceCandidate));
});

function leaveGlobalChat() {
    wsconn.invoke('LeaveChat', GLOBAL_CHAT);
}

function setup_local_media(callback, errorBack) {
    startingTrials++;
    if (local_media_stream != null) {  /* ie, if we've already been initialized */
        if (callback) callback();
        return;
    }
    /* Ask user for permission to use the computers microphone and/or camera, 
     * attach it to an <audio> or <video> tag if they give us access. */
    console.log('Requesting access to local audio / video inputs');


    navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);

    attachMediaStream = function (element, stream) {
        console.log('DEPRECATED, attachMediaStream will soon be removed.');
        element.srcObject = stream;
    };

    navigator.getUserMedia({ "audio": USE_AUDIO, "video": USE_VIDEO },
        function (stream) { /* user accepted access to a/v */
            console.log('Access granted to audio/video');
            local_media_stream = stream;
            const localMedia = USE_VIDEO ? $('<video  width="320" height="240" controls>') : $('<audio>');
            localMedia.attr('autoplay', 'autoplay');
            localMedia.attr('muted', 'true'); /* always mute ourselves by default */
            $('body').append(localMedia);
            attachMediaStream(localMedia[0], stream);

            if (callback) callback();
        },
        function () { /* user denied access to a/v */
            console.log('Access denied for audio/video');
            if (startingTrials < 2) {
                setup_local_media(callback, errorBack);
            }
            
            if (errorBack) errorBack();
        });
}