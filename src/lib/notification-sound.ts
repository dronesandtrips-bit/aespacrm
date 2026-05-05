// Gera um "pop" curto via WebAudio — sem precisar de arquivo de áudio.
// Usado para notificar mensagens novas no /inbox.

let ctx: AudioContext | null = null;
let lastPlay = 0;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

export function playMessagePing(volume = 0.4) {
  const c = getCtx();
  if (!c) return;
  // Throttle: no máximo um som a cada 400ms para evitar rajadas.
  const now = Date.now();
  if (now - lastPlay < 400) return;
  lastPlay = now;

  try {
    if (c.state === "suspended") c.resume().catch(() => {});
    const t = c.currentTime;
    // Dois bipes curtos ascendentes (estilo WhatsApp Web).
    const tones = [
      { f: 880, start: 0, dur: 0.09 },
      { f: 1320, start: 0.1, dur: 0.12 },
    ];
    for (const tone of tones) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = tone.f;
      gain.gain.setValueAtTime(0, t + tone.start);
      gain.gain.linearRampToValueAtTime(volume, t + tone.start + 0.01);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        t + tone.start + tone.dur,
      );
      osc.connect(gain).connect(c.destination);
      osc.start(t + tone.start);
      osc.stop(t + tone.start + tone.dur + 0.02);
    }
  } catch {
    /* noop */
  }
}

const ENABLED_KEY = "zapcrm.notif.sound.enabled";
const VOLUME_KEY = "zapcrm.notif.sound.volume";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const v = window.localStorage.getItem(ENABLED_KEY);
  return v == null ? true : v === "1";
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_KEY, enabled ? "1" : "0");
}

export function getSoundVolume(): number {
  if (typeof window === "undefined") return 0.4;
  const v = Number(window.localStorage.getItem(VOLUME_KEY));
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.4;
}

export function setSoundVolume(v: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOLUME_KEY, String(v));
}
