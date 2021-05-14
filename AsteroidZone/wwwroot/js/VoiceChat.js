// Audio context used to decode received audio bytes from voice chat and then play them
let context;

// Whether the voice chat is currently running
let voiceChatRunning = false; 

// WebSocket object used for establishing connection between the client and the server for passing voice chat audio bytes
let chatWebSocket = null;

// RecordRTC object encoding the received microphone stream
let recordAudio = null;

// Microphone stream of the recorded microphone bytes
let voiceRecStream = null;

// Create the audio context object on start
(function () {
    // Check whether the current browser supports audio context
    if (!window.AudioContext) {
        if (!window.webkitAudioContext) {
            alert('Your browser does not support any AudioContext and cannot play back this audio.');
            return;
        }
        window.AudioContext = window.webkitAudioContext;
    }

    // Create the audio context object
    context = new AudioContext();
})();

/**
 * Plays the audio inside of an array buffer
 */
function playByteArray(arrayBuffer) {
    // Decode the audio data and play it
    context.decodeAudioData(arrayBuffer,
        function (buffer) {
            play(buffer);
        }).catch(err => console.log(err));
}

/**
 * Play the loaded buffer
 */
function play(buffer) {
    // Create a source node from the buffer
    var source = context.createBufferSource();
    source.buffer = buffer;
    // Connect to the final output node (the speakers)
    source.connect(context.destination);
    // Play immediately
    source.start(0);
}

/**
 * Starts streaming the microphone captured audio bytes to the server. Joins the voice chat
 */
function startVoiceStream() {
    // Check whether the voice chat is not already running
    if (voiceChatRunning) {
        console.log('Voice Chat is already running. Stop it before starting it again');
        return;
    }

    // Set the flag for voice chat running
    voiceChatRunning = true;

    // Get the URL of the server
    const urlArr = window.location.href.split("/");

    // Establish a WebSocket with the server
    chatWebSocket = new WebSocket(`wss://${urlArr[2]}/ws_chat`);

    // Make the returned type an array buffer
    chatWebSocket.binaryType = 'arraybuffer';

    // Set the handler for the returned data to just play the audio bytes
    chatWebSocket.onmessage = (event) => {
        playByteArray(event.data);
    }

    // Start capturing the audio bytes from the client
    navigator.getUserMedia({
            audio: true
        },
        function (stream) {
            // Keep the stream object as it is used for stopping (leaving) the voice chat
            voiceRecStream = stream;

            // Create the object for encoding the microphone bytes in the necessary format
            recordAudio = RecordRTC(stream,
                {
                    // Set format
                    type: 'audio',
                    mimeType: 'audio/wav',
                    desiredSampRate: 16000,

                    recorderType: StereoAudioRecorder,
                    numberOfAudioChannels: 1,
                    timeSlice: 5,

                    // When the microphone bytes have been encoded directly stream via the WebSocket to the server
                    ondataavailable: function (blob) {
                        if (chatWebSocket.readyState === WebSocket.OPEN) {
                            chatWebSocket.send(blob);
                        }
                    }
                });

            // Start the recording process
            recordAudio.startRecording();
        },
        function(error) {
            console.error(JSON.stringify(error));
        });
};

/**
 * Stops the voice stream and makes the user leave the voice chat
 */
function stopVoiceStream() {
    // Check whether the voice chat is running at all
    if (!voiceChatRunning) {
        console.log('Voice Chat can\'t be stopped because it is not running. Start it before stopping it.');
        return;
    }

    // Set the flag that the voice chat has been stopped
    voiceChatRunning = false;

    // Stop all tracks from the microphone audio stream
    if (voiceRecStream) {
        voiceRecStream.getTracks().forEach(function(track) {
            track.stop();
        });
    }

    // Destroy the audio encoding object
    if (recordAudio) {
        recordAudio.stopRecording();
        recordAudio.destroy();
    }

    // Close the voice chat WebSocket
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.close();
    }
}

// Make sure the WebSocket has been destroyed when the page is closing
$(window).on('beforeunload', function () {
    if (chatWebSocket !== null && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.close();
    }
});