/** Get the URL of the server */
const urlArr = window.location.href.split('/');

/** Get the URL to which a connection with the signalling server should be established */
const hubUrl = `https://${urlArr[2]}/ConnectionHub`;

/** Establishing a new connection with the signalling server using the necessary URL. WebSockets will be used for the connection */
let signalRConn = new signalR.HubConnectionBuilder()
    .withUrl(hubUrl, signalR.HttpTransportType.WebSockets)
    .configureLogging(signalR.LogLevel.None).build();

/** Whether video should be using in the voice chat */
const USE_VIDEO = false;

/** Whether audio should be used in the voice chat */
const USE_AUDIO = true;

/** Whether the voice chat should be muted by default */
const MUTE_AUDIO_BY_DEFAULT = false;

/** Trials made by the js context to access the microphone (asking for user permission) */
let startingTrials = 0;

/** List of ICE Servers to use for establishing a connection between the clients */
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' }
];

/** Name of the chat to be joined */
let chatName = null;

/** Stream object of the local microphone/video bytes */
let localMediaStream = null;

/* keep track of our peer connections, indexed by peer_id */
let peers = {};

/* keep track of our <video>/<audio> tags, indexed by peer_id */
let peerMediaElements = {};

/** Flag used to determine whether the voice chat is currently running */
let chatRunning = false;

/** DOM JQuery object used to append the <video>/<audio> tags */
let audioList = null;

// Execute the following code when the whole DOM has been loaded
$(document).ready(function () {
    // Initialise the audios list
    audioList = $('#audios-list');

    // Initialise the Signalling Hub
    initializeSignalR();
});

/**
 * Join the voice chat having a specific name
 * @param {any} chat name of the chat to be joined
 */
function joinVoiceChat(chat) {
    // Make sure the voice chat is not already running
    if (chatRunning) {
        console.log('Voice chat is already running');
        return;
    }

    // Save the name of the voice chat
    chatName = chat;

    // Start the process of joining the voice chat
    setupLocalMedia(function () {
        // Mark that the voice chat has been joined
        chatRunning = true;

        /* once the user has given us access to their
         * microphone/camcorder, join the channel and start peering up */
        signalRConn.invoke('JoinChat', chatName);

        // Start the chat muted
        muteMyselfInVoiceChat();
    });
}

/**
 * Leave the voice chat
 */
function leaveVoiceChat() {
    // Make sure that the chat is running first
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be left');
        return;
    }

    // Invoke the LeaveChat method on the server
    signalRConn.invoke('LeaveChat', chatName);

    // Set the flag that the chat is not running anymore
    chatRunning = false;

    // Clear all <audio> elements from the audios list
    audioList.empty();

    // Stop all tracks from the local audio/video stream
    localMediaStream.getTracks().forEach(function (track) {
        track.stop();
    });

    // Clear the stream variable
    localMediaStream = null;

    // Refresh the number of trials
    startingTrials = 0;
}

/**
 * Mute my voice in the voice chat
 */
function muteMyselfInVoiceChat() {
    // Make sure the voice chat is running in order to mute it
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be mute');
        return;
    }

    // Disable all of the tracks in the local stream
    localMediaStream.getAudioTracks().forEach(track => track.enabled = false);
}

/**
 * Unmute my voice in the voice chat
 */
function unmuteMyselfInVoiceChat() {
    // Make sure the voice chat is running in order to mute it
    if (!chatRunning) {
        console.log('Voice chat must be running in order to be un-mute');
        return;
    }

    // Enable all of the tracks in the local stream
    localMediaStream.getAudioTracks().forEach(track => track.enabled = true);
}

/**
 * Initialises the Signalling connection with the server
 */
function initializeSignalR() {
    // Start the connection and put a notification on the console that it has successfully started
    signalRConn.start().then(() => {
        console.log('SignalR: Connected');
    }).catch(err => console.log(err));
};

/**
 * Handler for Adding a peer to the call
 * @param {any} peerId The ID of the peer to be added
 * @param {any} createOffer whether the current client needs to create the actual WebRTC offer
 */
signalRConn.on('AddToCall', (peerId, createOffer) => {
    /*if (peerId in peers) {
        /* This could happen if the user joins multiple channels where the other peer is also in.
        console.log('Already connected to peer ', peerId);
        return;
    }*/

    // Create a new peer connection for the new client joining the voice chat
    var peerConnection = new RTCPeerConnection(
        { "iceServers": ICE_SERVERS },
        { "optional": [{ "DtlsSrtpKeyAgreement": true }] } /* this will no longer be needed by chrome
                                                            * eventually (supposedly), but is necessary 
                                                            * for now to get firefox to talk to chrome */
    );

    // save the peer connection with the peer ID
    peers[peerId] = peerConnection;

    // Add a handler for the onicecandidate callback
    peerConnection.onicecandidate = function (event) {
        if (event.candidate) {
            // Invoke the necessary method on the server to communicate with the other clients
            signalRConn.invoke('RelayIceCandidate', chatName, peerId, {
                'sdpMLineIndex': event.candidate.sdpMLineIndex,
                'candidate': event.candidate.candidate
            });
        }
    }

    // Add a handler for when a stream is added to the WebRTC connection
    peerConnection.onaddstream = function (event) {
        // Check whether a video connection needs to be used
        const remoteMedia = USE_VIDEO ? $('<video width="320" height="240" controls>') : $('<audio>');

        // Make the media play instantly
        remoteMedia.attr('autoplay', 'autoplay');

        // Check whether the voice chat should be muted by default
        if (MUTE_AUDIO_BY_DEFAULT) {
            remoteMedia.attr('muted', 'true');
        } else {
            remoteMedia.removeAttr('muted');
        }

        // Add the media element to the list
        peerMediaElements[peerId] = remoteMedia;

        // Append the media element to the media node (audio list)
        audioList.append(remoteMedia);

        // Set the source of the media to be the stream received by the other user
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

/**
 * Handler for Removing a peer from the call
 * @param {any} peerId The ID of the peer to be removed
 */
signalRConn.on('RemoveFromCall', (peerId) => {
    // Find the media element of the peer and remove it
    if (peerId in peerMediaElements) {
        peerMediaElements[peerId].remove();
    }

    // Close the connection with the peer
    if (peerId in peers) {
        peers[peerId].close();
    }

    // Delete the unnecessary elements from the lists
    delete peers[peerId];
    delete peerMediaElements[config.peer_id];
});

/**
 * Handler for receiving a session description
 * @param {any} peerId The ID of the peer whose description was received
 * @param {any} remodeDescription description of the peer
 */
signalRConn.on('SessionDescription', function (peerId, remoteDescription) {
    // Get the connection with the peer
    var peer = peers[peerId];

    // Create a new RTC session description object using the remote description
    const desc = new RTCSessionDescription(remoteDescription);

    // Set the remote description of the peer connection
    const stuff = peer.setRemoteDescription(desc,
        function () {
            // Check whether an offer is made
            if (remoteDescription.type === 'offer') {
                // Create an answer to the offer by sending the local description to the offerer
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

/**
 * Used for receiving the ice candidate of another peer in the voice chat
 * @param {any} peerId The ID of the peer whose ICE candidate was received
 * @param {any} iceCandidate the ICE candidate of the peer
 */
signalRConn.on('IceCandidate', function (peerId, iceCandidate) {
    // Get the peer connection
    const peer = peers[peerId];

    // Add the ICE candidate to the connection
    peer.addIceCandidate(new RTCIceCandidate(iceCandidate));
});

/**
 * Sets up the local media stream in order to be able to start the WebRTC connection
 * @param {any} callback callback after the local media has been set
 * @param {any} errorBack error callback
 */
function setupLocalMedia(callback, errorBack) {
    // Increment the trials of joining the chat
    startingTrials++;

    // ie, if we've already been initialized
    if (localMediaStream != null) {
        if (callback) callback();
        return;
    }

    /* Ask user for permission to use the computers microphone and/or camera, 
     * attach it to an <audio> or <video> tag if they give us access. */
    navigator.getUserMedia = (navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia);

    // Start capturing the user media
    navigator.getUserMedia({ "audio": USE_AUDIO, "video": USE_VIDEO },
        function (stream) { /* user accepted access to a/v */

            // Save the local media stream
            localMediaStream = stream;

            // Execute the success callback
            if (callback) callback();
        },
        function () { /* user denied access to a/v */
            console.log('Access denied for audio/video');

            // If we haven't reached the max num of trial, try again
            if (startingTrials <= 2) {
                setupLocalMedia(callback, errorBack);
            }

            // Execute the error callback
            if (errorBack) errorBack();
        });
}