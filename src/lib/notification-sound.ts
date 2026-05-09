// Central de notificações do ZapCRM: som via WebAudio + notificações nativas
// do navegador, com deduplicação para Realtime + polling não tocarem em dobro.

type BrowserNotificationPermission = NotificationPermission | "unsupported";

type IncomingMessageNotification = {
  id?: string | null;
  messageId?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  body?: string | null;
  fromMe?: boolean | null;
  isGroup?: boolean | null;
  at?: string | null;
};

const ENABLED_KEY = "zapcrm.notif.sound.enabled";
const VOLUME_KEY = "zapcrm.notif.sound.volume";
const BROWSER_ENABLED_KEY = "zapcrm.notif.browser.enabled";

let ctx: AudioContext | null = null;
let lastPlay = 0;
const recentNotifications = new Map<string, number>();

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

function schedulePing(c: AudioContext, volume: number) {
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
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.start + tone.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t + tone.start);
    osc.stop(t + tone.start + tone.dur + 0.02);
  }
}

export async function unlockNotificationSound() {
  const c = getCtx();
  if (!c) return false;

  try {
    if (c.state === "suspended") await c.resume().catch(() => undefined);

    // Alguns navegadores só liberam áudio após uma ação real do usuário.
    // Este beep silencioso "prepara" o AudioContext sem tocar notificação audível.
    const t = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.00001, t);
    gain.gain.exponentialRampToValueAtTime(0.000001, t + 0.03);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.04);
    return c.state === "running";
  } catch {
    return false;
  }
}

export function primeNotificationSoundOnGesture() {
  if (typeof window === "undefined") return () => {};

  const unlock = () => unlockNotificationSound();
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);

  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

export function playMessagePing(volume = 0.4) {
  const c = getCtx();
  if (!c) return;
  // Throttle: no máximo um som a cada 400ms para evitar rajadas.
  const now = Date.now();
  if (now - lastPlay < 400) return;
  lastPlay = now;

  try {
    if (c.state === "suspended") {
      c.resume().then(() => schedulePing(c, volume)).catch(() => {});
      return;
    }
    schedulePing(c, volume);
  } catch {
    /* noop */
  }
}

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

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isBrowserNotificationSupported()) return "unsupported";
  return window.Notification.permission;
}

export function areBrowserNotificationsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (!isBrowserNotificationSupported()) return false;
  const v = window.localStorage.getItem(BROWSER_ENABLED_KEY);
  return v == null ? true : v === "1";
}

export function setBrowserNotificationsEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BROWSER_ENABLED_KEY, enabled ? "1" : "0");
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isBrowserNotificationSupported()) return "unsupported";
  if (window.Notification.permission === "default") {
    const permission = await window.Notification.requestPermission();
    setBrowserNotificationsEnabled(permission === "granted");
    return permission;
  }
  setBrowserNotificationsEnabled(window.Notification.permission === "granted");
  return window.Notification.permission;
}

export async function activateNotifications() {
  setSoundEnabled(true);
  setBrowserNotificationsEnabled(true);
  const audioReady = await unlockNotificationSound();
  const browserPermission = await requestBrowserNotificationPermission();
  return { audioReady, browserPermission };
}

function notificationKey(input: IncomingMessageNotification) {
  return (
    input.messageId ||
    input.id ||
    [input.contactId ?? "unknown", input.at ?? "no-time", input.body ?? ""].join(":")
  );
}

function wasRecentlyNotified(key: string) {
  const now = Date.now();
  for (const [k, t] of recentNotifications) {
    if (now - t > 60_000) recentNotifications.delete(k);
  }
  const last = recentNotifications.get(key);
  if (last && now - last < 30_000) return true;
  recentNotifications.set(key, now);
  return false;
}

function safeNotificationBody(body?: string | null) {
  const text = (body ?? "Nova mensagem recebida").trim() || "Nova mensagem recebida";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function showBrowserNotification(title: string, body?: string | null) {
  if (!areBrowserNotificationsEnabled()) return false;
  if (getBrowserNotificationPermission() !== "granted") return false;
  try {
    const n = new window.Notification(title, {
      body: safeNotificationBody(body),
      tag: `zapcrm-${title}`,
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    setTimeout(() => n.close(), 8000);
    return true;
  } catch {
    return false;
  }
}

export async function showTestBrowserNotification() {
  const permission = await requestBrowserNotificationPermission();
  if (permission !== "granted") return permission;
  showBrowserNotification("ZapCRM", "Notificações do WhatsWeb ativadas.");
  return permission;
}

export function notifyIncomingMessage(input: IncomingMessageNotification) {
  if (input.fromMe || input.isGroup) return;
  const key = notificationKey(input);
  if (wasRecentlyNotified(key)) return;

  if (isSoundEnabled()) playMessagePing(getSoundVolume());

  const title = input.contactName ? `Mensagem de ${input.contactName}` : "Nova mensagem no WhatsWeb";
  showBrowserNotification(title, input.body);
}
