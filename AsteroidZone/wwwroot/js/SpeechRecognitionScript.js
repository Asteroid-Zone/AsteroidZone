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

//const webSocket = new WebSocket('ws://localhost/AsteroidZone/ws');

//const constraints = {
//    audio: {
//        channelCount: 1,
//        sampleRate: 16000,
//        volume: 1
//    }
//}

//webSocket.onopen = event => {
//    console.log('info: connected to server');

//    navigator.mediaDevices
//        .getUserMedia({ audio: true, video: false })
//        .then(stream => {

//            const audioTracks = stream.getAudioTracks();
//            if (audioTracks.length !== 1) throw new Error('too many tracks');
//            const audioTrack = audioTracks[0];
//            audioTrack.applyConstraints(constraints)
//                .then(() => {

//                    const mediaRecorder = new MediaRecorder(stream,
//                        {
//                            mimeType: 'audio/webm',
//                        });

//                    mediaRecorder.addEventListener('dataavailable',
//                        event => {
//                            if (event.data.size > 0) {
//                                webSocket.send(event.data);
//                            }
//                        });

//                    mediaRecorder.start(250);

//                    setTimeout(() => {
//                        audioTrack.stop();
//                        mediaRecorder.stop();
//                        setTimeout(() => webSocket.close(), 1000);
//                    },
//                    20000);

//                })
//                .catch(console.error); /* you might get constraint failure here. */
//        });
//};

//webSocket.onmessage = (event) => {
//    console.log('WebSocket message received:', event.data);
//}