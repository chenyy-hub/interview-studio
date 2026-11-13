'use strict';
// A bounded, headless child owns device enumeration. Some macOS/driver
// combinations block inside CoreAudio; they must not freeze the app's UI.
const audio = require('../native-module/index.js');
const inputs = audio.getInputDevices();
const outputs = audio.getOutputDevices();
process.stdout.write(JSON.stringify({ inputs, outputs }), () => process.exit(0));
