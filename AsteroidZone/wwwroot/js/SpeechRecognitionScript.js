let recognition = null;
let recognitionWebSocket = null;
let voiceRecStream = null;
let recordAudio = null;
let voiceRecIsRunning = false;

/**
 * Checks if the current browser is Google Chrome
 */
function isChrome() {
    return new UAParser().getResult().browser.name.includes("Chrome");
}

document.addEventListener('DOMContentLoaded', function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

    if (!SpeechRecognition) {
        return;
    }

    // Attach recognition object to window so that it can be accessed outside of this scope (at start and stop recognition functions called by Unity)
    recognition = new SpeechRecognition();
    const speechRecognitionList = new SpeechGrammarList();

    // Check https://developer.syn.co.in/tutorial/speech/jsgf-grammar.html
    const commands = ['pirate', 'pirates', 'asteroid', 'asteroids', 'ping', 'pin', 'at', 'north', 'south', 'east', 'west', 'go', 'move', 'to', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const grammar = `#JSGF V1.0; grammar commands; public <command> = (${commands.join(' | ')} );`;

    speechRecognitionList.addFromString(grammar, 1);
    recognition.grammars = speechRecognitionList;
    recognition.continuous = true;
    recognition.lang = 'en-Gb';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = function (event) {
        var interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            interimTranscript += event.results[i][0].transcript;
        }

        if (typeof unityInstance === 'undefined') {
            console.log(interimTranscript);
        } else {
            unityInstance.SendMessage('CommandListener', 'GetResponse', interimTranscript);
        }
    }

    recognition.onend = function () {
        if (!flagStopRecognition) {
            recognition.start();
        }
    }

    recognition.onerror = function (event) {
        console.log("Error: " + event.error);
    }

    recognition.onnomatch = () => {
        console.log('No match!');
    };
});

// A flag used when the recognition should be stopped and then the onend listener should not start again
var flagStopRecognition = false;

/**
 * Called within Unity to START the voice recognition process.
 */
function startVoiceRecognition() {
    if (voiceRecIsRunning) {
        console.log('Voice Recognition is already running');
        return;
    }

    voiceRecIsRunning = true;

    if (isChrome()) {
        startChromeVoiceRecognition();
        console.log("Chrome Voice Rec started");
    } else {
        startNonChromeVoiceRecognition();
        console.log("NON Chrome Voice Rec started");
    }
}


/**
 * Called within Unity to STOP the voice recognition process.
 */
function stopVoiceRecognition() {
    if (!voiceRecIsRunning) {
        console.log('Voice Recognition must be running in order to be stopped');
        return;
    }

    voiceRecIsRunning = false;

    if (isChrome()) {
        stopChromeVoiceRecognition();
    } else {
        stopNonChromeVoiceRecognition();
    }
}

/**
 * Starts the voice recognition process for Google Chrome Browser
 */
function startChromeVoiceRecognition() {
    if (recognition) {
        flagStopRecognition = false;
        recognition.start();
    }
}

/**
 * Stops the voice recognition process for Google Chrome Browser
 */
function stopChromeVoiceRecognition() {
    if (recognition) {
        flagStopRecognition = true;
        recognition.stop();
    }
}

function startNonChromeVoiceRecognition() {
    const urlArr = window.location.href.split("/");
    recognitionWebSocket = new WebSocket(`wss://${urlArr[2]}/ws_vr`);
    recognitionWebSocket.onmessage = (event) => {
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
                    ondataavailable: function(blob) {
                        recognitionWebSocket.send(blob);
                    }
                });
            
            recordAudio.startRecording();
        },
        function(error) {
            console.error(JSON.stringify(error));
        });
};

function stopNonChromeVoiceRecognition() {
    if (voiceRecStream) {
        voiceRecStream.getTracks().forEach(function (track) {
            track.stop();
        });
    }

    if (recordAudio) {
        recordAudio.stopRecording();
        recordAudio.destroy();
    }

    if (recognitionWebSocket && recognitionWebSocket.readyState === WebSocket.OPEN) {
        recognitionWebSocket.close();
    }
}

function readTextToSpeech(phrase) {
    if ('speechSynthesis' in window) {
        var msg = new SpeechSynthesisUtterance();
        msg.text = phrase;
        msg.lang = 'en';
        msg.volume = 1;
        msg.rate = 1;
        msg.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(msg);
    }
}