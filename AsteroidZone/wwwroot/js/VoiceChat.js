var context; // Audio context
var buf; // Audio buffer

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
    fileReader.onload = function () {
        window.audioArray = this.result;
    };
    fileReader.readAsArrayBuffer(blob);
    if (typeof window.audioArray === 'undefined') {
        return;
    }

    context.decodeAudioData(window.audioArray,
        function(buffer) {
            buf = buffer;
            play();
        }).catch(err => console.log(err));
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
    const urlArr = window.location.href.split("/");
    window.chatWebSocket = new WebSocket(`wss://${urlArr[2]}/ws_chat`);
    window.chatWebSocket.onmessage = (event) => {
        playByteArray(event.data);
    }

    navigator.getUserMedia({
            audio: true
        },
        function(stream) {
            window.voiceRecStream = stream;
            window.recordAudio = RecordRTC(stream,
                {
                    type: 'audio',
                    mimeType: 'audio/wav',
                    desiredSampRate: 10000,

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
                        if (window.chatWebSocket.readyState === WebSocket.OPEN) {
                            window.chatWebSocket.send(blob);
                        }
                    }
                });

            window.recordAudio.startRecording();
        },
        function(error) {
            console.error(JSON.stringify(error));
        });
};

function stopVoiceStream() {
    if (window.voiceRecStream) {
        window.voiceRecStream.getTracks().forEach(function(track) {
            track.stop();
        });
    }

    if (window.recordAudio) {
        window.recordAudio.stopRecording();
        window.recordAudio.destroy();
    }

    if (window.chatWebSocket && window.chatWebSocket.readyState === WebSocket.OPEN) {
        window.chatWebSocket.close();
    }
}

$(window).on('beforeunload', function () {
    if (typeof window.chatWebSocket !== 'undefined' && window.chatWebSocket.readyState === WebSocket.OPEN) {
        window.chatWebSocket.close();
    }
});