document.addEventListener('DOMContentLoaded', function () {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;

    if (!SpeechRecognition) {
        return;
    }

    // Attach recognition object to window so that it can be accessed outside of this scope (at start and stop recognition functions called by Unity)
    window.recognition = new SpeechRecognition();
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

        unityInstance.SendMessage('CommandListener', 'GetResponse', interimTranscript);
    }

    recognition.onend = () => recognition.start();
    
    recognition.onerror = function (event) {
        console.log("Error: " + event.message);
        //recognition.start();
    }

    recognition.onnomatch = () => {
        console.log('No match!');
    };
});

/**
 * Called within Unity to START the voice recognition process.
 */
function startVoiceRecognition() {
    if (window.recognition) {
        recognition.start();
    }
}

/**
 * Called within Unity to STOP the voice recognition process.
 */
function stopVoiceRecognition() {
    if (window.recognition) {
        recognition.onend = () => { };
        recognition.stop();
    }
}