//document.addEventListener('DOMContentLoaded', function () {
//    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
//    const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

//    if (!SpeechRecognition) {
//        return;
//    }

//    // Attach recognition object to window so that it can be accessed outside of this scope (at start and stop recognition functions called by Unity)
//    window.recognition = new SpeechRecognition();
//    const speechRecognitionList = new SpeechGrammarList();

//    // Check https://developer.syn.co.in/tutorial/speech/jsgf-grammar.html
//    const commands = ['pirate', 'pirates', 'asteroid', 'asteroids', 'ping', 'pin', 'at', 'north', 'south', 'east', 'west', 'go', 'move', 'to', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
//    const grammar = `#JSGF V1.0; grammar commands; public <command> = (${commands.join(' | ')} );`;

//    speechRecognitionList.addFromString(grammar, 1);
//    recognition.grammars = speechRecognitionList;
//    recognition.continuous = true;
//    recognition.lang = 'en-Gb';
//    recognition.interimResults = true;
//    recognition.maxAlternatives = 1;

//    recognition.onresult = function (event) {
//        var interimTranscript = '';
//        for (let i = event.resultIndex; i < event.results.length; ++i) {
//            interimTranscript += event.results[i][0].transcript;
//        }

//        unityInstance.SendMessage('CommandListener', 'GetResponse', interimTranscript);
//    }

//    recognition.onend = function () {
//        if (!flagStopRecognition) {
//            recognition.start();
//        }
//    }

//    recognition.onerror = function (event) {
//        console.log("Error: " + event.error);
//    }

//    recognition.onnomatch = () => {
//        console.log('No match!');
//    };
//});

//// A flag used when the recognition should be stopped and then the onend listener should not start again
//var flagStopRecognition = false;

///**
// * Called within Unity to START the voice recognition process.
// */
//function startVoiceRecognition() {
//    if (window.recognition) {
//        flagStopRecognition = false;
//        recognition.start();
//    }
//}

///**
// * Called within Unity to STOP the voice recognition process.
// */
//function stopVoiceRecognition() {
//    if (window.recognition) {
//        flagStopRecognition = true;
//        recognition.stop();
//    }
//}

function startVoiceRecognition() {
    const urlArr = window.location.href.split("/");
    window.recognitionWebSocket = new WebSocket(`wss://${urlArr[2]}/ws`);
    window.recognitionWebSocket.onmessage = (event) => {
        if (typeof unityInstance === 'undefined') {
            console.log(event.data);
        } else {
            unityInstance.SendMessage('CommandListener', 'GetResponse', event.data);
        }
    }


    navigator.getUserMedia({
            audio: true
        },
        function(stream) {
            window.voiceRecStreeam = stream;
            window.recordAudio = RecordRTC(stream,
                {
                    type: 'audio',
                    mimeType: 'audio/webm',
                    desiredSampRate: 44100,

                    recorderType: StereoAudioRecorder,
                    numberOfAudioChannels: 1,


                    //1)
                    // get intervals based blobs
                    // value in milliseconds
                    // as you might not want to make detect calls every seconds
                    timeSlice: 500,

                    //2)
                    // as soon as the stream is available
                    ondataavailable: function(blob) {
                        window.recognitionWebSocket.send(blob);
                    }
                });
            
            window.recordAudio.startRecording();
        },
        function(error) {
            console.error(JSON.stringify(error));
        });
};

function stopVoiceRecognition() {
    if (window.voiceRecStreeam) {
        window.voiceRecStreeam.getTracks().forEach(function (track) {
            track.stop();
        });
    }

    if (window.recordAudio) {
        window.recordAudio.stopRecording();
        window.recordAudio.destroy();
    }

    if (window.recognitionWebSocket && window.recognitionWebSocket.readyState === WebSocket.OPEN) {
        window.recognitionWebSocket.close();
    }
}