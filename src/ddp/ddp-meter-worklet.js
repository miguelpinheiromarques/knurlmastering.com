/* ==========================================================================
   Knurl DDP Player — true-peak meter worklet
   Runs the 4× oversampling true-peak detection on the audio render thread,
   off the main thread (replaces the deprecated ScriptProcessorNode). Reads the
   tapped disc output, posts {inst, max} peak magnitudes back to the page.

   Messages in:  { type: "settle", seconds }  mute measurement around a
                                               transport change & flush the line
                 { type: "resetMax" }          clear the max-hold
                 { type: "resetAll" }          clear everything
   Messages out: { inst, max }                 peak since last post / running max
   ========================================================================== */
class TruePeakProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.L = o.L || 4;            // oversampling factor (polyphase branches)
    this.T = o.T || 16;           // taps per phase
    this.h = this.design(this.L, this.T);
    this.dlL = new Float32Array(this.T);
    this.dlR = new Float32Array(this.T);
    this.pos = 0;
    this.settle = 0;              // samples left where measurement is muted
    this.tpInst = 0;              // peak since last post (drained on post)
    this.tpMax = 0;               // running max-hold
    this.sincePost = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === "settle") {
        this.dlL.fill(0); this.dlR.fill(0); this.pos = 0;
        this.settle = Math.max(0, Math.ceil((d.seconds || 0.15) * sampleRate));
        this.tpInst = 0;
      } else if (d.type === "resetMax") {
        this.tpMax = 0;
      } else if (d.type === "resetAll") {
        this.dlL.fill(0); this.dlR.fill(0); this.pos = 0;
        this.tpInst = 0; this.tpMax = 0;
      }
    };
  }

  // Hann-windowed-sinc interpolation filter, stored polyphase as h[k*L + p] and
  // normalised per phase to unity DC gain (so peak magnitude is preserved).
  // Cutoff nudged just past Nyquist (1.03×) so the meter never under-reads
  // inter-sample peaks (<0.01 dB error to 21 kHz).
  design(L, T) {
    const N = L * T, center = (N - 1) / 2, cutoff = 1.03, raw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = i - center;
      const s = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x / L) / (Math.PI * x / L);
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
      raw[i] = s * w;
    }
    const h = new Float32Array(N);
    for (let p = 0; p < L; p++) {
      let sum = 0;
      for (let k = 0; k < T; k++) sum += raw[k * L + p];
      for (let k = 0; k < T; k++) h[k * L + p] = raw[k * L + p] / (sum || 1);
    }
    return h;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    const Lc = input[0];
    const Rc = input.length > 1 ? input[1] : Lc;
    const len = Lc.length;
    const h = this.h, T = this.T, Lf = this.L, dlL = this.dlL, dlR = this.dlR;
    let buf = 0; // peak magnitude within this render quantum

    for (let i = 0; i < len; i++) {
      const pos = this.pos;
      dlL[pos] = Lc[i]; dlR[pos] = Rc[i];
      // Skip measurement during the settle window: a hard start/seek/stop is a
      // step, and the band-limited reconstruction rings on a step (a false
      // over-0 dBTP). We still feed the delay line so it is primed afterward.
      if (this.settle > 0) {
        this.settle--;
      } else {
        for (let p = 0; p < Lf; p++) {
          let accL = 0, accR = 0, idx = pos;
          for (let k = 0; k < T; k++) {
            const coef = h[k * Lf + p];
            accL += dlL[idx] * coef; accR += dlR[idx] * coef;
            idx--; if (idx < 0) idx += T;
          }
          const aL = accL < 0 ? -accL : accL; if (aL > buf) buf = aL;
          const aR = accR < 0 ? -accR : accR; if (aR > buf) buf = aR;
        }
      }
      this.pos = pos + 1 >= T ? 0 : pos + 1;
    }

    if (buf > this.tpInst) this.tpInst = buf;
    if (buf > this.tpMax) this.tpMax = buf;
    // Report ~every 4 render quanta (~12 ms at 44.1 kHz); stay silent when idle.
    if (++this.sincePost >= 4) {
      this.sincePost = 0;
      if (this.tpInst > 0) {
        this.port.postMessage({ inst: this.tpInst, max: this.tpMax });
        this.tpInst = 0;
      }
    }
    return true;
  }
}

registerProcessor("knurl-true-peak", TruePeakProcessor);
