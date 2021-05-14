/** Voice Recognition object */
let recognition = null;

/** Web Socket used for sending the microphone raw data to the server and receiving the result phrases */
let recognitionWebSocket = null;

/** The microphone stream recording the microphone data and used for sending that data via the socket */
let voiceRecStream = null;

/**The RecordRTC object used for recording the voice stream and converting the recorded data stream to the necessary format */
let recordAudio = null;

/** Holds whether voice recognition is currently running */
let voiceRecIsRunning = false;

/** A flag used when the recognition should be stopped and then the onend listener should not start again */
let flagStopRecognition = false;

/** Marker being appended to the final speech recognition result */
const speechRecFinalResultMarker = '<FINAL>';

/**
 * Checks if the current browser is Google Chrome or not. Returns true if Chrome and false otherwise.
 */
function isChrome() {
    return new UAParser().getResult().browser.name.includes('Chrome');
}

/**
 * Executes when the DOM Content has been loaded
 */
document.addEventListener('DOMContentLoaded', function () {
    // Initialise the Chrome voice recognition engine if current browser is Google Chrome
    if (isChrome()) {
        initialiseChromeSpeechRec();
    }
});

/**
 * Initialises the Speech Recognition Engine for Google Chrome
 */
function initialiseChromeSpeechRec() {
    // Some browsers (e.g. Chrome) use prefixes to the name of these functions
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

    // Check if Speech recognition exists in the current context
    if (!SpeechRecognition) {
        return;
    }

    // Attach recognition object to window so that it can be accessed outside of this scope (at start and stop recognition functions called by Unity)
    recognition = new SpeechRecognition();
    const speechRecognitionList = new SpeechGrammarList();

    // Check https://developer.syn.co.in/tutorial/speech/jsgf-grammar.html for how grammar works.
    const commands = ['pirate', 'pirates', 'asteroid', 'asteroids', 'ping', 'pin', 'at', 'north', 'south', 'east', 'west', 'go', 'move', 'to', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const grammar = `#JSGF V1.0; grammar commands; public <command> = (${commands.join(' | ')} );`;

    // Add the grammar commands to the recognition engine and set other properties of the object
    speechRecognitionList.addFromString(grammar, 1);
    recognition.grammars = speechRecognitionList;
    recognition.continuous = true;
    recognition.lang = 'en-Gb';
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    // On Result method called when a result phrase is received
    recognition.onresult = function (event) {
        var interimTranscript = '';
        var final = false;
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            interimTranscript += event.results[i][0].transcript;
            if (event.results[i].isFinal) final = true;
        }

        // Check whether the current context has the unity instance and if so send the result to it. Otherwise, just print on the console
        if (typeof unityInstance === 'undefined') {
            console.log((final ? `${speechRecFinalResultMarker} ` : '') + interimTranscript);
        } else {
            // Check whether the recognised text is final and call the necessary function
            unityInstance.SendMessage('CommandListener', final ? 'GetFinalResponse' : 'GetResponse', interimTranscript);
        }
    }

    // Always start the engine onend unless the flag to stop hasn't been set
    recognition.onend = function () {
        if (!flagStopRecognition) {
            recognition.start();
        }
    }

    // If an error was received simply print on the console
    recognition.onerror = function (event) {
        console.log("Error: " + event.error);
    }

    // If there was no match for the speech, then print on the console
    recognition.onnomatch = () => {
        console.log('No match!');
    };
}

/**
 * Called within Unity to START the voice recognition process.
 */
function startVoiceRecognition() {
    // Check whether voice recognition is not already running
    if (voiceRecIsRunning) {
        console.log('Voice Recognition is already running');
        return;
    }

    // Set the flag that recognition is running
    voiceRecIsRunning = true;

    // Determine the current browser and start the necessary recognition engine accordingly
    if (isChrome()) {
        startChromeVoiceRecognition();
        console.log('Chrome Voice Rec started');
    } else {
        startNonChromeVoiceRecognition();
        console.log('NON Chrome Voice Rec started');
    }
}


/**
 * Called within Unity to STOP the voice recognition process.
 */
function stopVoiceRecognition() {
    // Check whether voice recognition is running at all
    if (!voiceRecIsRunning) {
        console.log('Voice Recognition must be running in order to be stopped');
        return;
    }

    // Set the flag that voice recognition has been stopped
    voiceRecIsRunning = false;

    // Call the necessary stopping voice recognition function according to the current browser
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
        // Set the flag to make voice recognition continue until stopped manually
        flagStopRecognition = false;
        recognition.start();
    }
}

/**
 * Stops the voice recognition process for Google Chrome Browser
 */
function stopChromeVoiceRecognition() {
    if (recognition) {
        // Set the flag to stop voice recognition and call the stop method
        flagStopRecognition = true;
        recognition.stop();
    }
}

/**
 * Starts the voice recognition engine on a non-chrome web browser
 */
function startNonChromeVoiceRecognition() {
    // Get the current URL
    const urlArr = window.location.href.split("/");

    // Open a WebSocket to the server voice recognition URL
    recognitionWebSocket = new WebSocket(`wss://${urlArr[2]}/ws_vr`);

    // Set the handler when a message is received
    recognitionWebSocket.onmessage = (event) => {
        // Extract the recognised phrase
        const phrase = event.data;

        // Remove the final marker from the phrase
        const phraseNoFinalMarker = phrase.replace(speechRecFinalResultMarker, '');

        // Check whether the phrase was final
        const phraseIsFinal = phrase !== phraseNoFinalMarker;
        // Check whether the current context has the unity instance and if so send the result to it. Otherwise, just print on the console
        if (typeof unityInstance === 'undefined') {
            console.log((phraseIsFinal ? `${speechRecFinalResultMarker} ` : '') + phraseNoFinalMarker);
        } else {
            unityInstance.SendMessage('CommandListener', phraseIsFinal ? 'GetFinalResponse' : 'GetResponse', phraseNoFinalMarker);
        }
    }

    // Start the microphone voice recording process
    navigator.getUserMedia({
            audio: true // Only audio should be recorded
        },
        function (stream) {
            // Save the stream object
            voiceRecStream = stream;

            // Create the Recording object which formats the audio in the necessary format
            recordAudio = RecordRTC(stream,
                {
                    type: 'audio',
                    mimeType: 'audio/wav',
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
                    ondataavailable: function (blob) {
                        // Send the recorded audio straight to the server via the WebSocket
                        if (recognitionWebSocket.readyState === 1) {
                            recognitionWebSocket.send(blob);
                        }
                    }
                });

            // Start recording the audio
            recordAudio.startRecording();
        },
        function (error) {
            // Display any errors to the user
            console.error(JSON.stringify(error));
        });
};

/**
 * Stops the speech recognition engine used on a non-chrome browser
 */
function stopNonChromeVoiceRecognition() {
    // Check whether the stream is recorded and if so stop it
    if (voiceRecStream) {
        voiceRecStream.getTracks().forEach(function (track) {
            track.stop();
        });
    }

    // Check the audio recording object exists and destroy it
    if (recordAudio) {
        recordAudio.stopRecording();
        recordAudio.destroy();
    }

    // Close the voice recognition WebSocket
    if (recognitionWebSocket && recognitionWebSocket.readyState === WebSocket.OPEN) {
        recognitionWebSocket.close();
    }
}

/**
 * Read a phrase to the user using the text-to-speech engine
 * @param {any} phrase
 */
function readTextToSpeech(phrase) {
    if ('speechSynthesis' in window) {
        var msg = new SpeechSynthesisUtterance();
        msg.text = phrase;
        msg.lang = 'en';
        msg.volume = 1;
        msg.rate = 1;
        msg.pitch = 1;
        window.speechSynthesis.cancel();
        //window.speechSynthesis.speak(msg);
    }
}