const urlArr = window.location.href.split('/');
const hubUrl = `https://${urlArr[2]}/ConnectionHub`;
let signalRConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl, signalR.HttpTransportType.WebSockets)
    .configureLogging(signalR.LogLevel.None).build();

const USE_VIDEO = false;
const USE_AUDIO = true;
const MUTE_AUDIO_BY_DEFAULT = false;
let startingTrials = 0;

const ICE_SERVERS = [
    { url: 'stun:stun.l.google.com:19302' }
];

let chatName = null;

let localMediaStream = null; /* our own microphone / webcam */
let peers = {};              /* keep track of our peer connections, indexed by peer_id */
let peerMediaElements = {};  /* keep track of our <video>/<audio> tags, indexed by peer_id */
let chatRunning = false;
let audioList = null;
let muteBtn = null;

$(document).ready(function () {
    audioList = $('#audios-list');
    initializeSignalR();
});

function joinVoiceChat(chat) {
    if (chatRunning) {
        console.log('Voice chat is already running');
        return;
    }

    chatName = chat;

    setupLocalMedia(function () {
        chatRunning = true;
        /* once the user has given us access to their
         * microphone/camcorder, join the channel and start peering up */
        signalRConn.invoke('JoinChat', chatName);

        // Start the chat muted
        muteMyselfInVoiceChat();
    });
}

function leaveVoiceChat() {
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be left');
        return;
    }

    signalRConn.invoke('LeaveChat', chatName);

    chatRunning = false;
    audioList.empty();

    localMediaStream.getTracks().forEach(function (track) {
        track.stop();
    });
    localMediaStream = null;

    startingTrials = 0;
}

function muteMyselfInVoiceChat() {
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be mute');
        return;
    }

    localMediaStream.getTracks().forEach(track => track.enabled = false);
}

function unmuteMyselfInVoiceChat() {
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be un-mute');
        return;
    }

    localMediaStream.getTracks().forEach(track => track.enabled = true);
}

const initializeSignalR = () => {
    signalRConn.start().then(() => {
        console.log('SignalR: Connected');
    }).catch(err => console.log(err));
};

signalRConn.on('AddToCall', (peerId, createOffer) => {
    /*if (peerId in peers) {
        /* This could happen if the user joins multiple channels where the other peer is also in.
        console.log('Already connected to peer ', peerId);
        return;
    }*/

    var peerConnection = new RTCPeerConnection(
        { "iceServers": ICE_SERVERS },
        { "optional": [{ "DtlsSrtpKeyAgreement": true }] } /* this will no longer be needed by chrome
                                                            * eventually (supposedly), but is necessary 
                                                            * for now to get firefox to talk to chrome */
    );
    peers[peerId] = peerConnection;

    peerConnection.onicecandidate = function (event) {
        if (event.candidate) {
            signalRConn.invoke('RelayIceCandidate', chatName, peerId, {
                'sdpMLineIndex': event.candidate.sdpMLineIndex,
                'candidate': event.candidate.candidate
            });
        }
    }

    peerConnection.onaddstream = function (event) {
        const remoteMedia = USE_VIDEO ? $('<video width="320" height="240" controls>') : $('<audio>');
        remoteMedia.attr('autoplay', 'autoplay');
        if (MUTE_AUDIO_BY_DEFAULT) {
            remoteMedia.attr('muted', 'true');
        } else {
            remoteMedia.removeAttr('muted');
        }
        peerMediaElements[peerId] = remoteMedia;
        audioList.append(remoteMedia);
        remoteMedia[0].srcObject = event.stream;
    }

    /* Add our local stream */
    peerConnection.addStream(localMediaStream);

    /* Only one side of the peer connection should create the
     * offer, the signaling server picks one to be the offerer. 
     * The other user will get a 'sessionDescription' event and will
     * create an offer, then send back an answer 'sessionDescription' to us
     */
    if (createOffer) {
        peerConnection.createOffer(
            function (localDescription) {
                peerConnection.setLocalDescription(localDescription,
                    function () {
                        signalRConn.invoke('RelaySessionDescription', chatName, peerId, localDescription);
                    },
                    function () { Alert('Offer setLocalDescription failed!'); }
                );
            },
            function (error) {
                console.log('Error sending offer: ', error);
            });
    }
});

signalRConn.on('RemoveFromCall', (peerId) => {
    if (peerId in peerMediaElements) {
        peerMediaElements[peerId].remove();
    }
    if (peerId in peers) {
        peers[peerId].close();
    }

    delete peers[peerId];
    delete peerMediaElements[config.peer_id];
});

signalRConn.on('SessionDescription', function (peerId, remoteDescription) {
    var peer = peers[peerId];

    const desc = new RTCSessionDescription(remoteDescription);
    const stuff = peer.setRemoteDescription(desc,
        function () {
            if (remoteDescription.type === 'offer') {
                peer.createAnswer(
                    function (localDescription) {
                        peer.setLocalDescription(localDescription,
                            function () {
                                signalRConn.invoke('RelaySessionDescription', chatName, peerId, localDescription);
                            },
                            function () { Alert('Answer setLocalDescription failed!'); }
                        );
                    },
                    function (error) {
                        console.log('Error creating answer: ', error, peer);
                    });
            }
        },
        function (error) {
            console.log('setRemoteDescription error: ', error);
        }
    );
});

signalRConn.on('IceCandidate', function (peerId, iceCandidate) {
    const peer = peers[peerId];
    peer.addIceCandidate(new RTCIceCandidate(iceCandidate));
});

function setupLocalMedia(callback, errorBack) {
    startingTrials++;
    if (localMediaStream != null) {  /* ie, if we've already been initialized */
        if (callback) callback();
        return;
    }
    /* Ask user for permission to use the computers microphone and/or camera, 
     * attach it to an <audio> or <video> tag if they give us access. */
    navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);

    navigator.getUserMedia({ "audio": USE_AUDIO, "video": USE_VIDEO },
        function (stream) { /* user accepted access to a/v */
            localMediaStream = stream;
            if (callback) callback();
        },
        function () { /* user denied access to a/v */
            console.log('Access denied for audio/video');
            if (startingTrials <= 2) {
                setupLocalMedia(callback, errorBack);
            }
            
            if (errorBack) errorBack();
        });
}