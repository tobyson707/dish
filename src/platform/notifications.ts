// Notifications adapter.
//  - Permission is requested only after the user turns a reminder on.
//  - Web Push (server-sent) needs VITE_VAPID_PUBLIC_KEY + the send-reminders
//    Edge Function; see PWA_OFFLINE.md for browser/OS limitations (iOS requires
//    the app to be installed to the Home Screen, 16.4+).
//  - Without push, reminders are shown locally while DISH is open.
import { env } from '@/lib/env'

export type PermissionState = 'unsupported' | 'default' | 'granted' | 'denied'

export function notificationPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as PermissionState
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (notificationPermission() === 'unsupported') return 'unsupported'
  return (await Notification.requestPermission()) as PermissionState
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!env.vapidPublicKey
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function subscribePush(): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey) }))
  return sub.toJSON()
}

export async function unsubscribePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  await sub?.unsubscribe()
}

export async function showLocalNotification(title: string, body: string, tag: string): Promise<void> {
  if (notificationPermission() !== 'granted') return
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
  if (reg) await reg.showNotification(title, { body, tag, icon: '/pwa-192.png', badge: '/pwa-192.png' })
  else new Notification(title, { body, tag })
}
