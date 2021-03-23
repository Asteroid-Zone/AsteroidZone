let context; // Audio context
let buf; // Audio buffer
let voiceChatRunning = false, chatWebSocket = null, recordAudio = null, voiceRecStream = null;

(function() {
    if (!window.AudioContext) {
        if (!window.webkitAudioContext) {
            alert("Your browser does not support any AudioContext and cannot play back this audio.");
            return;
        }
        window.AudioContext = window.webkitAudioContext;
    }

    context = new AudioContext();
})();

function playByteArray(blob) {
    const fileReader = new FileReader();
    let audioArray = null;

    fileReader.onload = function () {
        audioArray = this.result;

        if (audioArray === null) {
            return;
        }

        context.decodeAudioData(audioArray,
            function (buffer) {
                buf = buffer;
                play();
            }).catch(err => console.log(err));
    };

    fileReader.readAsArrayBuffer(blob);
}

// Play the loaded file
function play() {
    // Create a source node from the buffer
    var source = context.createBufferSource();
    source.buffer = buf;
    // Connect to the final output node (the speakers)
    source.connect(context.destination);
    // Play immediately
    source.start(0);
}


function startVoiceStream() {
    if (voiceChatRunning) {
        console.log('Voice Chat is already running. Stop it before starting it again');
        return;
    }

    voiceChatRunning = true;
    const urlArr = window.location.href.split("/");
    chatWebSocket = new WebSocket(`wss://${urlArr[2]}/ws_chat`);
    chatWebSocket.onmessage = (event) => {
        playByteArray(event.data);
    }

    navigator.getUserMedia({
            audio: true
        },
        function(stream) {
            voiceRecStream = stream;
            recordAudio = RecordRTC(stream,
                {
                    type: 'audio',
                    mimeType: 'audio/wav',
                    desiredSampRate: 16000,

                    recorderType: StereoAudioRecorder,
                    numberOfAudioChannels: 1,


                    //1)
                    // get intervals based blobs
                    // value in milliseconds
                    // as you might not want to make detect calls every seconds
                    timeSlice: 10,

                    //2)
                    // as soon as the stream is available
                    ondataavailable: function (blob) {
                        if (chatWebSocket.readyState === WebSocket.OPEN) {
                            chatWebSocket.send(blob);
                        }
                    }
                });

            recordAudio.startRecording();
        },
        function(error) {
            console.error(JSON.stringify(error));
        });
};

function stopVoiceStream() {
    if (!voiceChatRunning) {
        console.log('Voice Chat can\'t be stopped because it is not running. Start it before stopping it.');
        return;
    }

    voiceChatRunning = false;

    if (voiceRecStream) {
        voiceRecStream.getTracks().forEach(function(track) {
            track.stop();
        });
    }

    if (recordAudio) {
        recordAudio.stopRecording();
        recordAudio.destroy();
    }

    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.close();
    }
}

$(window).on('beforeunload', function () {
    if (chatWebSocket !== null && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.close();
    }
});