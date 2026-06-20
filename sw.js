/* Service Worker - 智律小管家
 * 功能：
 *   1. 离线缓存（页面关闭后仍可访问）
 *   2. 推送通知（后台 push 消息）
 *   3. 后台闹钟检查（尽可能在 SW 存活期间响铃）
 *   4. 跨标签页消息同步
 */

const CACHE_NAME = 'zhilv-cache-v2';
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json'
];

// 闹钟数据（从主线程同步）
let alarmList = [];
let lastTriggered = {};  // 避免同一分钟重复触发

// ============ 安装：缓存静态资源 ============
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
            .then(() => self.skipWaiting())
    );
});

// ============ 激活：清理旧缓存 ============
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

// ============ 拦截请求：离线优先策略 ============
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                // 动态缓存同源 GET 请求
                if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => caches.match('./index.html'));
        })
    );
});

// ============ 消息接收：主线程同步闹钟 / 同步命令 ============
self.addEventListener('message', event => {
    const { type, alarms } = event.data || {};

    if (type === 'SYNC_ALARMS' && Array.isArray(alarms)) {
        alarmList = alarms.filter(a => a && a.time && a.enabled !== false);
        console.log('[SW] 已同步闹钟:', alarmList);
    }

    if (type === 'CHECK_NOW') {
        checkAlarms();
    }
});

// ============ 推送通知 ============
self.addEventListener('push', event => {
    let data = { title: '智律小管家', body: '提醒' };
    try {
        if (event.data) {
            const parsed = event.data.json();
            if (parsed && typeof parsed === 'object') {
                data = Object.assign(data, parsed);
            }
        }
    } catch (e) {
        data.body = event.data ? event.data.text() : '提醒';
    }

    const options = {
        body: data.body || '闹钟提醒',
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>',
        vibrate: [200, 100, 200, 100, 200],
        tag: data.tag || 'alarm-notification',
        requireInteraction: true
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '智律小管家', options)
    );
});

// ============ 通知点击 ============
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url.includes('index.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./index.html');
            }
        })
    );
});

// ============ 核心：后台闹钟检查 ============
function checkAlarms() {
    const now = new Date();
    const currentTime =
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0');
    const dateKey = now.toDateString() + ' ' + currentTime;

    if (!alarmList || alarmList.length === 0) return;

    alarmList.forEach(alarm => {
        if (!alarm || !alarm.time || alarm.enabled === false) return;
        if (alarm.time === currentTime && lastTriggered[dateKey] !== alarm.time) {
            lastTriggered[dateKey] = alarm.time;

            const options = {
                body: (alarm.name || '闹钟') + ' - 时间到了！',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>',
                badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>',
                vibrate: [200, 100, 200, 100, 200],
                tag: 'alarm-' + alarm.time.replace(':', '-'),
                requireInteraction: true
            };

            self.registration.showNotification('⏰ 智律小管家', options);
            console.log('[SW] 触发闹钟:', alarm);
        }
    });
}

// 每 30 秒检查一次（在 SW 存活期间持续运行）
// 注意：浏览器可能在页面关闭后一段时间内终止 SW，但安装为 PWA 后会更稳定
setInterval(checkAlarms, 30000);
// 立即检查一次
checkAlarms();

console.log('[SW] Service Worker 已启动 - 智律小管家');
