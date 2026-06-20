/* ============ 智律小管家 - 核心脚本 ============
 * 说明：以 localStorage 作为闹钟数据的单一数据源。
 * DOM 只做渲染，不反向读取数据。任何改动先写回 localStorage，再重新渲染。
 */

/* ============ Agnes AI API 配置 ============ */
const AGNES_CONFIG = {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-tIQbtS4899pY8zv4mtL7iAf5nBLpD6NY5AWVv8ho4vADZxZb',
    model: 'agnes-2.0-flash'
};

/* ============ 本地存储（闹钟 / 作息 / 记忆 / 统计） ============ */
const STORAGE_KEY = 'zhilv_data_v1';

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    // 首次访问：预置 3 个示例闹钟，避免页面空白
    const defaults = {
        alarms: [
            buildAlarmData('07:00:00', '工作日', true),
            buildAlarmData('12:30:00', '每日', true),
            buildAlarmData('22:30:00', '每日', false)
        ],
        schedule: [],
        memory: [],
        stats: {}
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults)); } catch (e) {}
    return defaults;
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // 如有云同步配置，顺带上传时间戳
    if (cloudSyncKey && firebaseDb) {
        try {
            const toUpload = JSON.parse(JSON.stringify(data));
            toUpload._syncTime = Date.now();
            const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
            firebaseDb.ref(path).set(toUpload).catch(() => {});
        } catch (e) {}
    }
}

/* ============ 工具：构造 / 解析闹钟对象 ============ */
function buildAlarmData(timeStr, label, enabled) {
    return {
        id: 'alarm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        time: timeStr || '00:00:00',        // HH:MM:SS
        name: label || '新闹钟',
        enabled: enabled !== false,
        repeat: 'daily',                      // daily | workday | weekend | once | custom
        customDays: [],                       // 0=周日 ... 6=周六
        vibrate: false,
        tone: 'classic'
    };
}

// 把 HH:MM:SS 切出 [小时, 分钟, 秒]
function parseTime(timeStr) {
    const parts = String(timeStr || '00:00:00').split(':').map(s => parseInt(s, 10) || 0);
    return { h: parts[0] || 0, m: parts[1] || 0, s: parts[2] || 0 };
}

// 把 0~23 小时转成"上午/中午/下午/晚上"描述（纯 UI 用）
function periodOfHour(hour) {
    if (hour < 6) return '凌晨';
    if (hour < 12) return '上午';
    if (hour < 14) return '中午';
    if (hour < 18) return '下午';
    return '晚上';
}

// repeat → 展示文本
function repeatLabel(alarm) {
    switch (alarm.repeat) {
        case 'daily':   return '每日';
        case 'workday': return '工作日';
        case 'weekend': return '周末';
        case 'once':    return '只响一次';
        case 'custom':
            if (!alarm.customDays || alarm.customDays.length === 0) return '自定义';
            const zh = ['日', '一', '二', '三', '四', '五', '六'];
            return '周' + alarm.customDays.slice().sort().map(d => zh[d]).join('、');
        default: return alarm.name || '闹钟';
    }
}

// 判断闹钟今天是否需要响
function shouldRingToday(alarm, now) {
    if (!alarm || alarm.enabled === false) return false;
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const isWorkday = day >= 1 && day <= 5;
    switch (alarm.repeat) {
        case 'daily':   return true;
        case 'workday': return isWorkday;
        case 'weekend': return !isWorkday;
        case 'once':    return true;     // 由触发侧决定删除
        case 'custom':
            return (alarm.customDays || []).includes(day);
        default: return true;
    }
}

/* ============ 顶部实时时钟 ============ */
function updateClockDisplay() {
    const now = new Date();
    const timeEl = document.getElementById('alarmHeaderTime');
    const dateEl = document.getElementById('alarmHeaderDate');
    if (timeEl) {
        timeEl.textContent =
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');
    }
    if (dateEl) {
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        dateEl.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + weekdays[now.getDay()];
    }
}

/* ============ 闹钟检查（每秒一次，在 HH:MM:00 精确触发） ============ */
function checkAlarms() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');

    // 只在整秒（==00）或秒数匹配闹钟时间才判断触发
    const data = loadData();
    if (!data.alarms || data.alarms.length === 0) return;

    let changed = false;
    data.alarms.forEach(alarm => {
        if (!alarm || !alarm.enabled) return;
        const t = parseTime(alarm.time);
        const alarmHh = String(t.h).padStart(2, '0');
        const alarmMm = String(t.m).padStart(2, '0');
        const alarmSs = String(t.s).padStart(2, '0');

        // 时间精确匹配（时分秒）并且今天应该响
        if (alarmHh === hh && alarmMm === mm && alarmSs === ss && shouldRingToday(alarm, now)) {
            triggerAlarm(alarm);
            // "只响一次" → 自动关闭
            if (alarm.repeat === 'once') {
                alarm.enabled = false;
                changed = true;
            }
        }
    });

    if (changed) {
        saveData(data);
        renderSavedAlarms();
    }
}

function triggerAlarm(alarm) {
    const t = parseTime(alarm.time);
    const showTime = String(t.h).padStart(2, '0') + ':' + String(t.m).padStart(2, '0');

    // 系统通知
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('⏰ 智律小管家', {
                body: (alarm.name || '闹钟') + ' - ' + showTime + ' 时间到了！',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>'
            });
        } catch (e) {}
    }

    // 震动
    if (alarm.vibrate && navigator.vibrate) {
        try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }

    // 播放简易提示音（Web Audio，无依赖）
    playAlarmSound(alarm.tone);
}

function playAlarmSound(tone) {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);

        const freqs = {
            classic: [880, 660, 880, 660],
            birds:   [1200, 1800, 1200, 1800],
            digital: [440, 880, 440, 880],
            nature:  [330, 220, 330, 220],
            chime:   [1320, 1320, 1320, 1320],
            rooster: [700, 900, 700, 1100]
        };
        const seq = freqs[tone] || freqs.classic;
        let t = ctx.currentTime;
        o.type = 'sine';
        g.gain.setValueAtTime(0.0001, t);
        seq.forEach((f, i) => {
            o.frequency.setValueAtTime(f, t + i * 0.2);
            g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.2 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.2 + 0.18);
        });
        o.start();
        o.stop(t + seq.length * 0.2 + 0.1);
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, seq.length * 250);
    } catch (e) {}
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

/* ============ 渲染闹钟列表（单一数据源：localStorage） ============ */
function renderSavedAlarms() {
    const listEl = document.getElementById('alarmList');
    if (!listEl) return;

    const data = loadData();
    const alarms = data.alarms || [];

    if (alarms.length === 0) {
        listEl.innerHTML =
            '<div style="text-align:center;padding:40px 20px;color:rgba(255,255,255,0.4);font-size:14px;">' +
            '暂无闹钟，点击下方"+新闹钟"添加一个吧</div>';
        return;
    }

    // 按时间升序排列
    const sorted = alarms.slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    listEl.innerHTML = sorted.map(alarm => {
        const t = parseTime(alarm.time);
        const period = periodOfHour(t.h);
        const hh12 = t.h % 12 === 0 ? 12 : (t.h % 12);
        const timeShow = String(hh12).padStart(2, '0') + ':' + String(t.m).padStart(2, '0');
        const label = repeatLabel(alarm);
        const enabledClass = alarm.enabled ? 'on' : '';
        const dimStyle = alarm.enabled ? '' : 'opacity:0.55;';
        return (
            '<div class="alarm-card" data-id="' + alarm.id + '" style="' + dimStyle + '">' +
            '  <div class="alarm-card-left">' +
            '    <div class="alarm-card-time">' +
            '      <span class="alarm-card-period">' + period + '</span>' +
            '      <span class="alarm-card-time-main">' + timeShow + '</span>' +
            '    </div>' +
            '    <div class="alarm-card-label">' + label + '</div>' +
            '  </div>' +
            '  <div class="alarm-card-right">' +
            '    <div class="alarm-card-switch ' + enabledClass + '" data-action="toggle" data-id="' + alarm.id + '">' +
            '      <div class="alarm-card-switch-thumb"></div>' +
            '    </div>' +
            '  </div>' +
            '</div>'
        );
    }).join('');
}

/* ============ 事件委托：开关 / 点击卡片编辑 / "+新闹钟" ============ */
function initAlarmListEventDelegation() {
    const listEl = document.getElementById('alarmList');
    if (listEl) {
        listEl.addEventListener('click', function (e) {
            // 开关
            const sw = e.target.closest('.alarm-card-switch');
            if (sw && sw.dataset.action === 'toggle') {
                e.stopPropagation();
                toggleAlarmEnabled(sw.dataset.id);
                return;
            }
            // 整张卡片 → 编辑
            const card = e.target.closest('.alarm-card');
            if (card && card.dataset.id) {
                openAlarmModal(card.dataset.id);
            }
        });
    }

    const addBtn = document.getElementById('alarmAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => openAlarmModal(null));
    }
}

function toggleAlarmEnabled(id) {
    const data = loadData();
    const alarm = (data.alarms || []).find(a => a.id === id);
    if (!alarm) return;
    alarm.enabled = !alarm.enabled;
    saveData(data);
    renderSavedAlarms();
    syncAlarmsToServiceWorker();
}

/* ============ Service Worker 同步 ============ */
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('sw.js');
        syncAlarmsToServiceWorker();
    } catch (e) { /* ignore */ }
}

function syncAlarmsToServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    const data = loadData();
    const list = (data.alarms || []).filter(a => a && a.enabled).map(a => ({
        time: (a.time || '00:00:00').split(':').slice(0, 2).join(':'),
        name: a.name || '闹钟',
        enabled: true
    }));
    navigator.serviceWorker.ready.then(reg => {
        if (reg && reg.active) {
            try { reg.active.postMessage({ type: 'SYNC_ALARMS', alarms: list }); } catch (e) {}
        }
    }).catch(() => {});
}

/* ============ 页面切换（底部导航） ============ */
function updateDateDisplay() {
    const now = new Date();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const dateEl = document.getElementById('currentDate');
    const weekdayEl = document.getElementById('weekday');
    if (dateEl) {
        dateEl.textContent = now.getFullYear() + '年' + String(now.getMonth() + 1).padStart(2, '0') + '月' + String(now.getDate()).padStart(2, '0') + '日';
    }
    if (weekdayEl) weekdayEl.textContent = weekdays[now.getDay()];
}

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById('page-' + pageId);
    if (target) target.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageId);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============ 开场动画 ============ */
function initIntro() {
    const intro = document.getElementById('introScreen');
    if (!intro) return;
    const messages = ['正在启动...', '加载资源...', '即将完成...', '欢迎使用!'];
    let idx = 0;
    const timer = setInterval(() => {
        idx++;
        const textEl = document.getElementById('introText');
        if (textEl && idx < messages.length) textEl.textContent = messages[idx];
    }, 900);
    const hide = () => {
        clearInterval(timer);
        intro.classList.add('hide');
        setTimeout(() => { intro.style.display = 'none'; }, 900);
    };
    setTimeout(hide, 5200);
    const skipBtn = document.getElementById('skipBtn');
    if (skipBtn) skipBtn.addEventListener('click', hide);
}

/* ============ 弹窗：添加 / 编辑闹钟 ============ */
let editingAlarmId = null;
let modalState = {
    hour: 8, minute: 0, second: 0,
    name: '',
    tone: 'classic',
    repeat: 'daily',
    vibrate: false,
    customDays: []
};

const RINGTONE_OPTIONS = [
    { id: 'classic', icon: '🔔', name: '经典' },
    { id: 'birds',   icon: '🐦', name: '鸟鸣' },
    { id: 'digital', icon: '📡', name: '电子音' },
    { id: 'nature',  icon: '🌿', name: '自然音' },
    { id: 'chime',   icon: '🎐', name: '风铃' },
    { id: 'rooster', icon: '🐓', name: '公鸡' }
];

const REPEAT_OPTIONS = [
    { id: 'daily',   label: '每日' },
    { id: 'workday', label: '工作日' },
    { id: 'weekend', label: '周末' },
    { id: 'once',    label: '只响一次' },
    { id: 'custom',  label: '自定义' }
];

function openAlarmModal(id) {
    editingAlarmId = id;
    const overlay = document.getElementById('alarmModalOverlay');
    const modal = document.getElementById('alarmModal');
    if (!overlay || !modal) return;

    const titleEl = document.getElementById('modalTitle');
    const delBtn = document.getElementById('modalDeleteBtn');
    const nameInput = document.getElementById('modalAlarmName');

    if (id) {
        const alarm = (loadData().alarms || []).find(a => a.id === id);
        if (alarm) {
            const t = parseTime(alarm.time);
            modalState.hour = t.h;
            modalState.minute = t.m;
            modalState.second = t.s;
            modalState.name = alarm.name || '';
            modalState.tone = alarm.tone || 'classic';
            modalState.repeat = alarm.repeat || 'daily';
            modalState.vibrate = !!alarm.vibrate;
            modalState.customDays = (alarm.customDays || []).slice();
            if (titleEl) titleEl.textContent = '编辑闹钟';
            if (delBtn) delBtn.style.display = 'flex';
        }
    } else {
        const now = new Date();
        modalState.hour = now.getHours();
        modalState.minute = (now.getMinutes() + 1) % 60;
        modalState.second = 0;
        modalState.name = '';
        modalState.tone = 'classic';
        modalState.repeat = 'daily';
        modalState.vibrate = false;
        modalState.customDays = [];
        if (titleEl) titleEl.textContent = '添加闹钟';
        if (delBtn) delBtn.style.display = 'none';
    }

    if (nameInput) nameInput.value = modalState.name;
    renderModalControls();
    overlay.style.display = 'flex';
    // 强制触发过渡
    void overlay.offsetWidth;
    overlay.classList.add('active');
    modal.classList.add('active');
}

function closeAlarmModal() {
    const overlay = document.getElementById('alarmModalOverlay');
    const modal = document.getElementById('alarmModal');
    if (!overlay || !modal) return;
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
    editingAlarmId = null;
}

function renderModalControls() {
    // 时间显示
    setTimeText('hourScroll', modalState.hour);
    setTimeText('minScroll', modalState.minute);
    setTimeText('secScroll', modalState.second);

    // 铃声
    const toneEl = document.getElementById('ringtoneList');
    if (toneEl) {
        toneEl.innerHTML = RINGTONE_OPTIONS.map(o =>
            '<div class="ringtone-item' + (o.id === modalState.tone ? ' selected' : '') + '" data-tone="' + o.id + '">' +
            '  <span class="ringtone-icon">' + o.icon + '</span>' +
            '  <span class="ringtone-name">' + o.name + '</span>' +
            '</div>'
        ).join('');
    }

    // 重复
    const repEl = document.getElementById('repeatOptions');
    if (repEl) {
        repEl.innerHTML = REPEAT_OPTIONS.map(o =>
            '<div class="repeat-chip' + (o.id === modalState.repeat ? ' selected' : '') + '" data-repeat="' + o.id + '">' + o.label + '</div>'
        ).join('');
    }

    // 自定义星期
    const customEl = document.getElementById('customDays');
    if (customEl) {
        if (modalState.repeat === 'custom') {
            customEl.style.display = 'flex';
            const zh = ['日', '一', '二', '三', '四', '五', '六'];
            customEl.innerHTML = zh.map((name, idx) =>
                '<div class="day-chip' + (modalState.customDays.includes(idx) ? ' selected' : '') + '" data-day="' + idx + '">' + name + '</div>'
            ).join('');
        } else {
            customEl.style.display = 'none';
        }
    }

    // 震动
    const vThumb = document.getElementById('vibrateThumb');
    const vStatus = document.getElementById('vibrateStatus');
    if (vThumb) vThumb.style.left = modalState.vibrate ? '26px' : '2px';
    if (vStatus) vStatus.textContent = modalState.vibrate ? '开启' : '关闭';
}

function setTimeText(containerId, value) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const inner = container.querySelector('.time-scroll-inner');
    if (inner) inner.textContent = String(value).padStart(2, '0');
}

function initAlarmModalListeners() {
    // 关闭 / 删除 / 保存
    document.getElementById('modalCloseBtn')?.addEventListener('click', closeAlarmModal);
    document.getElementById('modalDeleteBtn')?.addEventListener('click', deleteAlarm);
    document.getElementById('modalSaveBtn')?.addEventListener('click', saveAlarm);
    document.getElementById('alarmModalOverlay')?.addEventListener('click', function (e) {
        if (e.target === this) closeAlarmModal();
    });

    // 时间滚轮（▲ / ▼ 按钮）
    bindTimeScroll('hourScroll', 24, v => { modalState.hour = v; });
    bindTimeScroll('minScroll', 60, v => { modalState.minute = v; });
    bindTimeScroll('secScroll', 60, v => { modalState.second = v; });

    // 名称输入
    document.getElementById('modalAlarmName')?.addEventListener('input', function () {
        modalState.name = this.value;
    });

    // 铃声
    document.getElementById('ringtoneList')?.addEventListener('click', function (e) {
        const item = e.target.closest('.ringtone-item');
        if (!item) return;
        modalState.tone = item.dataset.tone;
        renderModalControls();
        playAlarmSound(modalState.tone);
    });

    // 重复
    document.getElementById('repeatOptions')?.addEventListener('click', function (e) {
        const chip = e.target.closest('.repeat-chip');
        if (!chip) return;
        modalState.repeat = chip.dataset.repeat;
        if (modalState.repeat !== 'custom') modalState.customDays = [];
        renderModalControls();
    });

    // 自定义星期
    document.getElementById('customDays')?.addEventListener('click', function (e) {
        const chip = e.target.closest('.day-chip');
        if (!chip) return;
        const d = parseInt(chip.dataset.day, 10);
        const idx = modalState.customDays.indexOf(d);
        if (idx >= 0) modalState.customDays.splice(idx, 1);
        else modalState.customDays.push(d);
        renderModalControls();
    });

    // 震动开关
    document.getElementById('vibrateToggle')?.addEventListener('click', function () {
        modalState.vibrate = !modalState.vibrate;
        renderModalControls();
        if (modalState.vibrate && navigator.vibrate) {
            try { navigator.vibrate(100); } catch (e) {}
        }
    });
}

function bindTimeScroll(containerId, max, onSet) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 确保容器内有 ▲ / ▼ 按钮
    let upBtn = container.querySelector('.scroll-up');
    let downBtn = container.querySelector('.scroll-down');
    if (!upBtn) {
        upBtn = document.createElement('button');
        upBtn.className = 'scroll-btn scroll-up';
        upBtn.textContent = '▲';
        container.appendChild(upBtn);
    }
    if (!downBtn) {
        downBtn = document.createElement('button');
        downBtn.className = 'scroll-btn scroll-down';
        downBtn.textContent = '▼';
        container.appendChild(downBtn);
    }

    upBtn.addEventListener('click', () => {
        const current = parseInt(container.querySelector('.time-scroll-inner')?.textContent || '0', 10);
        onSet((current + 1) % max);
        setTimeText(containerId, (current + 1) % max);
    });
    downBtn.addEventListener('click', () => {
        const current = parseInt(container.querySelector('.time-scroll-inner')?.textContent || '0', 10);
        const next = (current - 1 + max) % max;
        onSet(next);
        setTimeText(containerId, next);
    });
}

function saveAlarm() {
    const data = loadData();
    data.alarms = data.alarms || [];

    const timeStr =
        String(modalState.hour).padStart(2, '0') + ':' +
        String(modalState.minute).padStart(2, '0') + ':' +
        String(modalState.second).padStart(2, '0');

    // 展示标签：优先用户输入的名称，否则显示重复描述
    const repeatText = (() => {
        const zh = ['日', '一', '二', '三', '四', '五', '六'];
        switch (modalState.repeat) {
            case 'daily': return '每日';
            case 'workday': return '工作日';
            case 'weekend': return '周末';
            case 'once': return '只响一次';
            case 'custom':
                return modalState.customDays.length
                    ? '周' + modalState.customDays.slice().sort().map(d => zh[d]).join('、')
                    : '自定义';
            default: return '闹钟';
        }
    })();
    const name = modalState.name && modalState.name.trim() ? modalState.name.trim() : repeatText;

    if (editingAlarmId) {
        const existing = data.alarms.find(a => a.id === editingAlarmId);
        if (existing) {
            existing.time = timeStr;
            existing.name = name;
            existing.tone = modalState.tone;
            existing.repeat = modalState.repeat;
            existing.vibrate = modalState.vibrate;
            existing.customDays = modalState.customDays.slice();
        }
    } else {
        const newAlarm = buildAlarmData(timeStr, name, true);
        newAlarm.tone = modalState.tone;
        newAlarm.repeat = modalState.repeat;
        newAlarm.vibrate = modalState.vibrate;
        newAlarm.customDays = modalState.customDays.slice();
        data.alarms.push(newAlarm);
    }

    saveData(data);
    closeAlarmModal();
    renderSavedAlarms();
    syncAlarmsToServiceWorker();
}

function deleteAlarm() {
    if (!editingAlarmId) return;
    if (!confirm('确定要删除这个闹钟吗？')) return;
    const data = loadData();
    data.alarms = (data.alarms || []).filter(a => a.id !== editingAlarmId);
    saveData(data);
    closeAlarmModal();
    renderSavedAlarms();
    syncAlarmsToServiceWorker();
}

/* ============ Agnes AI 对话 ============ */
async function sendToAI(userMessage) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;

    const userMsg = document.createElement('div');
    userMsg.className = 'ai-msg ai-user';
    userMsg.innerHTML =
        '<div class="ai-bubble"><p>' + escapeHtml(userMessage) + '</p></div>';
    chatArea.appendChild(userMsg);
    chatArea.scrollTop = chatArea.scrollHeight;

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ai-msg ai-bot';
    loadingMsg.innerHTML =
        '<div class="ai-avatar">🤖</div>' +
        '<div class="ai-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>';
    chatArea.appendChild(loadingMsg);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const resp = await fetch(AGNES_CONFIG.baseUrl + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + AGNES_CONFIG.apiKey
            },
            body: JSON.stringify({
                model: AGNES_CONFIG.model,
                messages: [
                    { role: 'system', content: '你是"智律小管家"的智能助手，帮助用户管理时间、养成习惯、规划作息。回答简洁友好，用中文。' },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7
            })
        });
        loadingMsg.remove();
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const json = await resp.json();
        const reply = json.choices?.[0]?.message?.content || '抱歉，暂时无法回答。';

        const botMsg = document.createElement('div');
        botMsg.className = 'ai-msg ai-bot';
        botMsg.innerHTML =
            '<div class="ai-avatar">🤖</div>' +
            '<div class="ai-bubble"><p>' + escapeHtml(reply).replace(/\n/g, '<br>') + '</p></div>';
        chatArea.appendChild(botMsg);
        chatArea.scrollTop = chatArea.scrollHeight;

        // 保存对话记录到本地
        const saved = loadData();
        saved.memory = saved.memory || [];
        saved.memory.push({ role: 'user', content: userMessage, time: new Date().toISOString() });
        saved.memory.push({ role: 'ai', content: reply, time: new Date().toISOString() });
        saveData(saved);
    } catch (err) {
        loadingMsg.remove();
        const errMsg = document.createElement('div');
        errMsg.className = 'ai-msg ai-bot';
        errMsg.innerHTML =
            '<div class="ai-avatar">⚠️</div>' +
            '<div class="ai-bubble"><p style="color:#ff6b6b;">AI 连接失败：' + escapeHtml(String(err.message || err)) + '</p></div>';
        chatArea.appendChild(errMsg);
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/* ============ 云同步（Firebase） ============ */
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD4kF_5154321567897654321",
    authDomain: "zhilv-demo.firebaseapp.com",
    databaseURL: "https://zhilv-demo-default-rtdb.firebaseio.com",
    projectId: "zhilv-demo",
    storageBucket: "zhilv-demo.appspot.com",
    messagingSenderId: "417770321",
    appId: "1:417770321:web:demo1234567890"
};
let cloudSyncKey = null;
let firebaseApp = null;
let firebaseDb = null;

function getFirebaseConfig() {
    try {
        const saved = localStorage.getItem('zhilv_firebase_config');
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_FIREBASE_CONFIG;
}
function saveFirebaseConfig(cfg) {
    localStorage.setItem('zhilv_firebase_config', JSON.stringify(cfg));
}
function initFirebase() {
    if (firebaseApp) return firebaseApp;
    if (typeof firebase === 'undefined') return null;
    try {
        const cfg = getFirebaseConfig();
        if (!cfg || !cfg.databaseURL || (cfg.apiKey || '').includes('demo')) {
            return null;
        }
        firebaseApp = firebase.apps.length > 0 ? firebase.apps[0] : firebase.initializeApp(cfg);
        firebaseDb = firebaseApp.database();
        return firebaseApp;
    } catch (e) { return null; }
}
function setSyncStatus(text) {
    const el = document.getElementById('cloudSyncStatus');
    if (el) el.textContent = text;
}
function getSyncKey() { return localStorage.getItem('zhilv_sync_key') || ''; }
function setSyncKey(key) {
    if (!key || !key.trim()) { alert('请输入同步密钥'); return; }
    localStorage.setItem('zhilv_sync_key', key.trim());
    cloudSyncKey = key.trim();
    setSyncStatus('🔑 已设置密钥：' + cloudSyncKey);
    alert('✅ 同步密钥已设置！\n在其他设备输入相同密钥即可同步数据。');
    downloadFromCloud();
}
function exportData() {
    const data = loadData();
    data._exportTime = new Date().toISOString();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zhilv-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    alert('✅ 数据已导出到下载文件夹');
}
function importData(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object') throw new Error('格式错误');
            saveData(data);
            renderSavedAlarms();
            alert('✅ 数据导入成功，即将刷新');
            setTimeout(() => location.reload(), 500);
        } catch (err) { alert('❌ 导入失败：' + err.message); }
    };
    reader.readAsText(file);
}
function uploadToCloud() {
    if (!cloudSyncKey) { alert('⚠️ 请先设置同步密钥'); return; }
    initFirebase();
    if (!firebaseDb) { alert('❌ Firebase 未连接，请先配置自定义 Firebase'); return; }
    const data = loadData();
    data._syncTime = Date.now();
    setSyncStatus('⬆️ 正在上传到云端...');
    try {
        const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
        firebaseDb.ref(path).set(data)
            .then(() => {
                setSyncStatus('✅ 已同步到云端 · ' + new Date().toLocaleTimeString());
                alert('✅ 数据已上传到云端！');
            })
            .catch(err => {
                setSyncStatus('❌ 上传失败：' + (err.message || err));
                alert('❌ 上传失败：' + (err.message || err));
            });
    } catch (e) { alert('❌ 上传异常：' + e.message); }
}
function downloadFromCloud() {
    if (!cloudSyncKey) { alert('⚠️ 请先设置同步密钥'); return; }
    initFirebase();
    if (!firebaseDb) { alert('❌ Firebase 未连接'); return; }
    setSyncStatus('⬇️ 正在从云端下载...');
    try {
        const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
        firebaseDb.ref(path).once('value').then(snap => {
            const data = snap.val();
            if (!data) {
                setSyncStatus('⚠️ 云端暂无数据');
                alert('⚠️ 云端暂无数据（密钥：' + cloudSyncKey + '）');
                return;
            }
            saveData(data);
            renderSavedAlarms();
            setSyncStatus('✅ 已从云端同步 · ' + new Date().toLocaleTimeString());
            alert('✅ 云端数据已同步，即将刷新');
            setTimeout(() => location.reload(), 500);
        }).catch(err => {
            setSyncStatus('❌ 下载失败：' + (err.message || err));
            alert('❌ 下载失败：' + (err.message || err));
        });
    } catch (e) { alert('❌ 下载异常：' + e.message); }
}

function initCloudSync() {
    const savedKey = getSyncKey();
    if (savedKey) {
        cloudSyncKey = savedKey;
        setSyncStatus('🔑 已连接密钥：' + cloudSyncKey);
        initFirebase();
    }
}
function initCloudSyncEventListeners() {
    const keyInput = document.getElementById('syncKeyInput');
    if (keyInput) keyInput.value = getSyncKey();
    document.getElementById('setSyncKeyBtn')?.addEventListener('click', () => {
        setSyncKey(keyInput?.value?.trim());
    });
    keyInput?.addEventListener('keypress', e => {
        if (e.key === 'Enter') setSyncKey(e.target.value.trim());
    });

    document.getElementById('exportDataBtn')?.addEventListener('click', exportData);
    const importFileInput = document.getElementById('importFileInput');
    document.getElementById('importDataBtn')?.addEventListener('click', () => importFileInput?.click());
    importFileInput?.addEventListener('change', e => {
        const f = e.target.files?.[0];
        if (f) importData(f);
        e.target.value = '';
    });

    document.getElementById('uploadCloudBtn')?.addEventListener('click', uploadToCloud);
    document.getElementById('downloadCloudBtn')?.addEventListener('click', downloadFromCloud);

    const fbInput = document.getElementById('firebaseConfigInput');
    document.getElementById('saveFirebaseBtn')?.addEventListener('click', () => {
        if (!fbInput) return;
        try {
            const cfg = JSON.parse(fbInput.value.trim());
            if (!cfg.apiKey || !cfg.databaseURL) throw new Error('缺少 apiKey 或 databaseURL');
            saveFirebaseConfig(cfg);
            alert('✅ Firebase 配置已保存，即将刷新');
            setTimeout(() => location.reload(), 500);
        } catch (e) { alert('❌ 配置格式错误：' + e.message); }
    });
}

/* ============ PWA 安装提示 ============ */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.style.display = 'inline-block';
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            await deferredPrompt.userChoice;
            installBtn.style.display = 'none';
            deferredPrompt = null;
        });
    }
});

/* ============ 导航与 AI 事件 ============ */
function initGlobalEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(item => {
        item.addEventListener('click', () => switchPage(item.dataset.page));
    });

    document.getElementById('currentDate')?.addEventListener('click', updateDateDisplay);

    // AI 发送
    const sendBtn = document.getElementById('sendBtn');
    const aiInput = document.getElementById('aiInput');
    sendBtn?.addEventListener('click', () => {
        const msg = aiInput?.value?.trim();
        if (msg) { sendToAI(msg); aiInput.value = ''; }
    });
    aiInput?.addEventListener('keypress', e => {
        if (e.key === 'Enter') {
            const msg = e.target.value.trim();
            if (msg) { sendToAI(msg); e.target.value = ''; }
        }
    });
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt) sendToAI(prompt);
        });
    });
}

/* ============ 唯一的启动入口 ============ */
document.addEventListener('DOMContentLoaded', function () {
    // 1. UI 初始化
    initIntro();
    updateDateDisplay();
    updateClockDisplay();

    // 2. 事件监听（全局 + 闹钟 + 弹窗 + 云同步）
    initGlobalEventListeners();
    initAlarmListEventDelegation();
    initAlarmModalListeners();
    initCloudSyncEventListeners();

    // 3. 数据 / 权限 / SW
    renderSavedAlarms();
    requestNotificationPermission();
    registerServiceWorker();
    initCloudSync();

    // 4. 定时任务
    setInterval(updateClockDisplay, 1000);   // 每秒刷新顶部时钟
    setInterval(checkAlarms, 1000);          // 每秒检查闹钟
    setInterval(syncAlarmsToServiceWorker, 5 * 60 * 1000); // 每 5 分钟同步到 SW
});
