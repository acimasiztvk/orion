// Web Audio API Utilities for ORION (PCM encoding/decoding, sound effects, streaming playback)

class SoundFXEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Futuristic boot / power-on chime
  playPowerOn() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.35);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {
      // ignore
    }
  }

  // Tactile HUD tick
  playHudTick() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1200, now);
      osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {
      // ignore
    }
  }

  // Tool activation holographic chime
  playToolExecuted() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      
      const freqs = [659.25, 880, 1174.66]; // E5, A5, D6
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + i * 0.06;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.08, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.25);
      });
    } catch (e) {
      // ignore
    }
  }

  // Listening start pulse
  playListeningStart() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch (e) {
      // ignore
    }
  }

  // Apple-style soft task completion chime
  playTaskChime() {
    try {
      const ctx = this.getContext();
      const now = ctx.currentTime;

      // Two soft harmonic sine tones (E6 = 1318.51 Hz, B6 = 1975.53 Hz)
      const tones = [
        { freq: 1318.51, delay: 0, duration: 0.28 },
        { freq: 1975.53, delay: 0.08, duration: 0.25 }
      ];

      tones.forEach(({ freq, delay, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const startTime = now + delay;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        // Soft envelope: quick 10ms attack, smooth exponential decay
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.06, startTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    } catch (e) {
      // ignore
    }
  }
}

export const soundFX = new SoundFXEngine();

// Shared Audio Stream Concurrency Coordinator to prevent mic hardware lockups
export let isAudioStreamBusy = false;
export function setAudioStreamBusy(busy: boolean) {
  isAudioStreamBusy = busy;
}

// Microphone Audio Streamer (16kHz PCM Little-Endian)
export class OrionMicStreamer {
  private audioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private onAudioChunk: ((base64Pcm: string, isSpeaking: boolean) => void) | null = null;
  private isRecording = false;

  async start(onAudioChunk: (base64Pcm: string, isSpeaking: boolean) => void, onAnalyserCreated?: (analyser: AnalyserNode) => void) {
    if (this.isRecording) return;
    setAudioStreamBusy(true);
    this.onAudioChunk = onAudioChunk;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: 16000 });
      await this.audioCtx.resume();

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

    const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 256;
    if (onAnalyserCreated) {
      onAnalyserCreated(this.analyserNode);
    }

    // Buffer size 4096 = ~256ms at 16kHz
    this.processorNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
    
    source.connect(this.analyserNode);
    this.analyserNode.connect(this.processorNode);
    this.processorNode.connect(this.audioCtx.destination);

    this.processorNode.onaudioprocess = (e) => {
      if (!this.isRecording) return;
      const inputData = e.inputBuffer.getChannelData(0);

      // Compute Root Mean Square (RMS) volume to detect human speech input vs silent room
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);
      const isSpeaking = rms > 0.008;

      const base64Pcm = this.float32ToInt16Base64(inputData);
      if (this.onAudioChunk) {
        this.onAudioChunk(base64Pcm, isSpeaking);
      }
    };

    this.isRecording = true;
    soundFX.playListeningStart();
    } catch (err) {
      setAudioStreamBusy(false);
      throw err;
    }
  }

  stop() {
    this.isRecording = false;
    setAudioStreamBusy(false);
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  private float32ToInt16Base64(float32Array: Float32Array): string {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const uint8 = new Uint8Array(int16Array.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    return btoa(binary);
  }
}

// 24kHz PCM Output Audio Player for Gemini Live API & TTS
export class OrionAudioPlayer {
  private audioCtx: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private analyserNode: AnalyserNode | null = null;
  private onPlaybackStateChange?: (isPlaying: boolean) => void;

  constructor(onPlaybackStateChange?: (isPlaying: boolean) => void) {
    this.onPlaybackStateChange = onPlaybackStateChange;
  }

  private ensureContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx({ sampleRate: 24000 });
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  getAnalyser(): AnalyserNode | null {
    if (!this.analyserNode) {
      this.ensureContext();
    }
    return this.analyserNode;
  }

  // Play a 24kHz 16-bit PCM base64 chunk
  playChunk(base64Pcm: string) {
    const ctx = this.ensureContext();
    try {
      const binary = atob(base64Pcm);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      if (this.analyserNode) {
        source.connect(this.analyserNode);
      } else {
        source.connect(ctx.destination);
      }

      const currentTime = ctx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime;
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.activeSources.push(source);

      if (this.onPlaybackStateChange) {
        this.onPlaybackStateChange(true);
      }

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx > -1) this.activeSources.splice(idx, 1);
        if (this.activeSources.length === 0 && this.onPlaybackStateChange) {
          this.onPlaybackStateChange(false);
        }
      };
    } catch (err) {
      console.warn("Failed to play audio chunk:", err);
    }
  }

  // Stop playback instantly (used for barge-in)
  interrupt() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {}
    }
    this.activeSources = [];
    if (this.audioCtx) {
      this.nextStartTime = this.audioCtx.currentTime;
    }
    if (this.onPlaybackStateChange) {
      this.onPlaybackStateChange(false);
    }
  }

  isPlaying(): boolean {
    return this.activeSources.length > 0;
  }
}

// Background Wake Word Detector for "Orion" using Web Speech API
export class WakeWordListener {
  private recognition: any = null;
  private isListening = false;
  private onWakeWordDetected: ((followingText?: string) => void) | null = null;
  private onError: ((err: any) => void) | null = null;
  private onStatusChange: ((status: { active: boolean; error?: string | null }) => void) | null = null;
  private isSupported = false;
  private shouldRestart = false;
  private lastTriggerTime = 0;

  // Teardown & Lifecycle State Flags
  private isRunning = false;
  private isAborting = false;
  private pendingResume = false;
  private abortWatchdog: any = null;
  private retryTimer: any = null;

  constructor(
    onWakeWordDetected: (followingText?: string) => void,
    onError?: (err: any) => void,
    onStatusChange?: (status: { active: boolean; error?: string | null }) => void
  ) {
    this.onWakeWordDetected = onWakeWordDetected;
    this.onError = onError || null;
    this.onStatusChange = onStatusChange || null;

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRec) {
      try {
        this.recognition = new SpeechRec();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        // Use user's browser language if Turkish/English for optimum recognition accuracy
        const navLang = (window.navigator?.language || 'tr-TR').toLowerCase();
        this.recognition.lang = navLang.startsWith('tr') ? 'tr-TR' : 'en-US';
        this.isSupported = true;

        this.recognition.onstart = () => {
          this.isRunning = true;
          this.isAborting = false;
          clearTimeout(this.abortWatchdog);
          console.log('[WAKE WORD] SpeechRecognition engine started successfully');
          if (this.onStatusChange) {
            this.onStatusChange({ active: true, error: null });
          }
        };

        this.recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = (event.results[i][0]?.transcript || '').toLowerCase().trim();
            
            // Check for wake words: "orion", "oryon", "oriyon", "hey orion", "ey orion", "ryan"
            const isMatch =
              transcript.includes('orion') ||
              transcript.includes('oryon') ||
              transcript.includes('oriyon') ||
              transcript.includes('o ryan') ||
              transcript.includes('orian') ||
              (transcript.includes('ryan') && (transcript.includes('hey') || transcript.includes('hi') || transcript.includes('ok')));

            if (isMatch) {
              const now = Date.now();
              // Debounce triggers to prevent duplicate rapid firing within 2.5 seconds
              if (now - this.lastTriggerTime > 2500) {
                this.lastTriggerTime = now;
                console.log('[WAKE WORD] Wake word "Orion" detected in browser local speech engine:', transcript);
                
                // Extract command after wake word if present
                const parts = transcript.split(/orion|oryon|oriyon|o ryan|orian/i);
                const following = parts.length > 1 ? parts[parts.length - 1].replace(/^[,.\s]+/, '').trim() : '';

                // Pause local engine immediately so microphone is freed for Gemini Live WebSocket stream
                this.pause();

                soundFX.playListeningStart();
                if (this.onWakeWordDetected) {
                  this.onWakeWordDetected(following);
                }
              }
              break;
            }
          }
        };

        this.recognition.onerror = (e: any) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.warn('[WAKE WORD] Recognition error:', e.error);
            if (this.onStatusChange) {
              this.onStatusChange({ active: false, error: e.error || 'Speech recognition error' });
            }
            if (this.onError) this.onError(e);
          }
        };

        this.recognition.onend = () => {
          console.log('[WAKE WORD] Engine onend teardown event fired. isAborting:', this.isAborting, 'pendingResume:', this.pendingResume);
          this.isRunning = false;
          this.isAborting = false;
          clearTimeout(this.abortWatchdog);

          if (this.pendingResume || (this.isListening && this.shouldRestart && !isAudioStreamBusy)) {
            this.pendingResume = false;
            this.shouldRestart = true;
            console.log('[WAKE WORD] Teardown complete. Re-activating listener...');
            setTimeout(() => {
              if (this.isListening && this.shouldRestart && !isAudioStreamBusy) {
                this.startInternal();
              }
            }, 80);
          } else {
            if (this.onStatusChange && !this.isListening) {
              this.onStatusChange({ active: false, error: null });
            }
          }
        };
      } catch (e) {
        console.warn('[WAKE WORD] SpeechRecognition initialization failed:', e);
        this.isSupported = false;
      }
    }
  }

  private startInternal(retryCount = 0) {
    if (!this.isSupported || !this.recognition || !this.isListening || isAudioStreamBusy) {
      console.log('[WAKE WORD] Cannot start listener — supported:', this.isSupported, 'isListening:', this.isListening, 'busy:', isAudioStreamBusy);
      return;
    }

    if (this.isRunning) {
      console.log('[WAKE WORD] Recognition engine already running');
      return;
    }

    if (this.isAborting) {
      this.pendingResume = true;
      console.log('[WAKE WORD] startInternal() deferred — recognition engine is currently aborting/tearing down');
      return;
    }

    try {
      this.recognition.start();
      console.log('[WAKE WORD] Background listener activated for "Orion"');
    } catch (e: any) {
      console.warn(`[WAKE WORD] start() failed (attempt ${retryCount + 1}):`, e?.name || e, e?.message || e);

      // If already started or invalid state, reset flags
      if (e?.name === 'InvalidStateError') {
        this.isRunning = true;
        this.isAborting = false;
        return;
      }

      // Retry once after a 250ms delay if start failed
      if (retryCount < 1 && this.isListening && this.shouldRestart) {
        console.log('[WAKE WORD] Scheduling retry in 250ms...');
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          if (this.isListening && this.shouldRestart && !isAudioStreamBusy) {
            this.startInternal(retryCount + 1);
          }
        }, 250);
      } else {
        console.error('[WAKE WORD] Permanent start failure after retries:', e);
        if (this.onStatusChange) {
          this.onStatusChange({ active: false, error: e?.message || 'Wake-word listener activation failed' });
        }
      }
    }
  }

  start() {
    if (!this.isSupported || !this.recognition || isAudioStreamBusy) return;
    this.isListening = true;
    this.shouldRestart = true;

    if (this.isAborting) {
      this.pendingResume = true;
      console.log('[WAKE WORD] start() called while engine is aborting — queued for onend teardown');
    } else {
      this.startInternal();
    }
  }

  stop() {
    this.shouldRestart = false;
    this.isListening = false;
    this.pendingResume = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.abortWatchdog);

    if (this.recognition && this.isRunning) {
      this.isAborting = true;
      try {
        this.recognition.stop();
      } catch (e) {
        this.isAborting = false;
        this.isRunning = false;
      }
      this.abortWatchdog = setTimeout(() => {
        if (this.isAborting) {
          this.isAborting = false;
          this.isRunning = false;
        }
      }, 350);
    } else {
      this.isAborting = false;
      this.isRunning = false;
    }
    if (this.onStatusChange) {
      this.onStatusChange({ active: false, error: null });
    }
  }

  pause() {
    this.shouldRestart = false;
    this.pendingResume = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.abortWatchdog);

    if (this.recognition && this.isRunning) {
      this.isAborting = true;
      try {
        this.recognition.abort();
      } catch (e) {
        this.isAborting = false;
        this.isRunning = false;
      }
      // Watchdog timer: If browser fails to emit onend after abort(), force clear isAborting
      this.abortWatchdog = setTimeout(() => {
        if (this.isAborting) {
          console.log('[WAKE WORD] Watchdog: abort onend timed out after 350ms — clearing isAborting flag');
          this.isAborting = false;
          this.isRunning = false;
          if (this.pendingResume && this.isListening && !isAudioStreamBusy) {
            this.pendingResume = false;
            this.startInternal();
          }
        }
      }, 350);
    } else {
      this.isAborting = false;
      this.isRunning = false;
    }
  }

  resume() {
    console.log('[WAKE WORD] resume() invoked. isSupported:', this.isSupported, 'isListening:', this.isListening, 'isRunning:', this.isRunning, 'isAborting:', this.isAborting, 'busy:', isAudioStreamBusy);
    if (!this.isSupported) return;

    this.isListening = true;
    this.shouldRestart = true;

    if (this.isAborting) {
      this.pendingResume = true;
      console.log('[WAKE WORD] resume() queued — recognition engine is currently aborting/tearing down');
    } else if (!isAudioStreamBusy) {
      this.startInternal();
    }
  }

  getIsSupported(): boolean {
    return this.isSupported;
  }

  getIsListening(): boolean {
    return this.isListening;
  }
}

// Background Audio Stream Manager for Standby Mode (Clap Detection + Visualizer Analyser)
export class BackgroundAudioStream {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private isRunning = false;

  async start(): Promise<AnalyserNode | null> {
    if (this.isRunning && this.analyserNode) {
      return this.analyserNode;
    }

    try {
      if (!this.mediaStream) {
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          }
        });
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      await this.audioCtx.resume();

      const source = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.2;

      source.connect(this.analyserNode);
      this.isRunning = true;
      console.log('[BACKGROUND AUDIO STREAM] Activated standby microphone stream for clap detection');
      return this.analyserNode;
    } catch (err) {
      console.warn('[BACKGROUND AUDIO STREAM] Standby microphone stream initialization failed:', err);
      return null;
    }
  }

  stop() {
    this.isRunning = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.analyserNode = null;
    console.log('[BACKGROUND AUDIO STREAM] Standby microphone stream stopped');
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// Acoustic Double-Clap Detector for Wake-Word Fallback Activation
export class ClapDetector {
  private analyser: AnalyserNode | null = null;
  private timerId: any = null;
  private onDoubleClap: (() => void) | null = null;
  private isListening = false;

  // State tracking
  private lastClapTime = 0;
  private lastDoubleClapTime = 0;
  private isSpikeActive = false;
  private spikeStartTime = 0;
  private spikeMaxPeak = 0;
  private movingAvgEnergy = 0.02;

  constructor(onDoubleClap: () => void) {
    this.onDoubleClap = onDoubleClap;
  }

  public attachAnalyser(analyser: AnalyserNode) {
    this.analyser = analyser;
  }

  public start(analyser?: AnalyserNode) {
    if (analyser) this.analyser = analyser;
    if (this.isListening) return;
    this.isListening = true;
    console.log('[CLAP DETECTOR] Listener active. Monitoring audio stream for double-clap acoustic signature...');

    // Poll at ~12ms interval (~80 FPS) to capture fast acoustic transients
    this.timerId = setInterval(() => {
      this.processFrame();
    }, 12);
  }

  public stop() {
    this.isListening = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    this.isSpikeActive = false;
    console.log('[CLAP DETECTOR] Listener stopped.');
  }

  public processFrame() {
    if (!this.analyser || !this.isListening) return;

    const bufferLength = this.analyser.frequencyBinCount; // 128 bins for fftSize=256
    const timeData = new Uint8Array(bufferLength);
    const freqData = new Uint8Array(bufferLength);

    this.analyser.getByteTimeDomainData(timeData);
    this.analyser.getByteFrequencyData(freqData);

    const now = Date.now();

    // 1. Calculate Peak Amplitude & RMS from time domain data
    let maxPeak = 0;
    let sumSq = 0;
    for (let i = 0; i < bufferLength; i++) {
      const normalized = Math.abs(timeData[i] - 128) / 128; // 0.0 to 1.0
      if (normalized > maxPeak) maxPeak = normalized;
      sumSq += normalized * normalized;
    }
    const rms = Math.sqrt(sumSq / bufferLength);

    // Update moving background noise level during ambient quiet
    if (rms < 0.05) {
      this.movingAvgEnergy = 0.95 * this.movingAvgEnergy + 0.05 * rms;
    }

    // 2. Frequency Spectrum Analysis (Broadband Content)
    const third = Math.floor(bufferLength / 3);
    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < third; i++) lowSum += freqData[i];
    for (let i = third; i < 2 * third; i++) midSum += freqData[i];
    for (let i = 2 * third; i < bufferLength; i++) highSum += freqData[i];

    const lowAvg = lowSum / third;
    const midAvg = midSum / third;
    const highAvg = highSum / (bufferLength - 2 * third);
    const totalAvg = (lowAvg + midAvg + highAvg) / 3;

    // Broadband signature check:
    // Claps have energy across all bands, especially mid & high frequencies.
    const isBroadband = highAvg > 20 && midAvg > 25 && totalAvg > 30;

    // Spike detection thresholds
    const PEAK_THRESHOLD = 0.25; // minimum peak amplitude
    const CONTRAST_RATIO = 3.2;  // must be > 3.2x background average

    const isHighPeak = maxPeak > PEAK_THRESHOLD && maxPeak > (this.movingAvgEnergy * CONTRAST_RATIO + 0.12);

    if (isHighPeak && isBroadband) {
      if (!this.isSpikeActive) {
        // Transient onset detected
        this.isSpikeActive = true;
        this.spikeStartTime = now;
        this.spikeMaxPeak = maxPeak;
      } else {
        if (maxPeak > this.spikeMaxPeak) this.spikeMaxPeak = maxPeak;
      }
    } else {
      if (this.isSpikeActive) {
        // Transient decay completed
        const duration = now - this.spikeStartTime;
        this.isSpikeActive = false;

        // Duration filter: Claps are brief impulses (8ms to 110ms)
        if (duration >= 8 && duration <= 110) {
          this.registerClapSpike(now);
        }
      }
    }
  }

  private registerClapSpike(now: number) {
    // 2-second cooldown check after a successful double-clap activation
    if (now - this.lastDoubleClapTime < 2000) {
      return;
    }

    const interval = now - this.lastClapTime;

    // Double-clap condition: two valid clap spikes within 150ms to 600ms of each other
    if (interval >= 150 && interval <= 600) {
      console.log(`[CLAP DETECTOR] DOUBLE-CLAP CONFIRMED! Interval: ${interval}ms. Triggering activation...`);
      this.lastDoubleClapTime = now;
      this.lastClapTime = 0; // reset single clap timer

      if (this.onDoubleClap) {
        this.onDoubleClap();
      }
    } else {
      console.log(`[CLAP DETECTOR] Single clap spike detected (${interval}ms since previous). Waiting for potential second clap in 150-600ms window...`);
      this.lastClapTime = now;
    }
  }

  public getIsListening(): boolean {
    return this.isListening;
  }
}

