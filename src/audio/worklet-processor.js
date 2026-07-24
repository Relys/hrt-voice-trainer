// Plain JS on purpose: audioWorklet.addModule() needs a real, already-executable script — Vite
// has no built-in bundling/transpiling for AudioWorklet module URLs the way it does for Worker,
// so a `new URL(...)` reference to a .ts file here gets copied verbatim, untranspiled, into the
// production build (see capture.ts's `?no-inline` comment). Keeping this file as valid JS from
// the start avoids needing a build step just for this one small processor.

/** Render quanta are 128 frames; batch a few before posting to cut message overhead. */
const CHUNK_SIZE = 512;

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  buffer = new Float32Array(CHUNK_SIZE);
  writeIndex = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.writeIndex++] = channel[i];
      if (this.writeIndex === CHUNK_SIZE) {
        this.port.postMessage({ type: "chunk", samples: this.buffer, sampleRate }, [this.buffer.buffer]);
        this.buffer = new Float32Array(CHUNK_SIZE);
        this.writeIndex = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-capture-processor", VoiceCaptureProcessor);
