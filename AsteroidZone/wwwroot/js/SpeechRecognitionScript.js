var recognizing = false;
var ignore_onend;

if (('webkitSpeechRecognition' in window)) {
	var recognition = new webkitSpeechRecognition();
	recognition.continuous = true;
	recognition.interimResults = true;

	recognition.onstart = function() {
		recognizing = true;
	};

	/*recognition.onerror = function(event) {
		if (event.error == 'no-speech') {
			ignore_onend = true;
		}

		if (event.error == 'audio-capture') {
			ignore_onend = true;
		}

		if (event.error == 'not-allowed') {
			ignore_onend = true;
		}
	};*/

	recognition.onend = function() {
		recognizing = false;

		if (ignore_onend) {
			return;
		}

		//Calls the speech recognition again
		start();

	};

	// This function is called within the Unity 3D
	function startButtonFromUnity3D() {
		start();
	}

	recognition.onresult = function(event) {
		var interim_transcript = '';
		for (var i = event.resultIndex; i < event.results.length; ++i) {
			if (!event.results[i].isFinal) {
				interim_transcript += event.results[i][0].transcript;
			}
		}

		unityInstance.SendMessage('CommandListener', 'GetResponse', interim_transcript);
	};

	function start() {
		if (recognizing) {
			recognition.stop();
			return;
		}

		recognition.lang = 'en-GB';
		recognition.start();
		ignore_onend = false;
	}

}

start();