/* ============ 智律小管家 - 核心脚本 ============
 * 说明：以 localStorage 作为闹钟数据的单一数据源。
 * DOM 只做渲染，不反向读取数据。任何改动先写回 localStorage，再重新渲染。
 */

/* ============ 版本控制 - 每次更新必须修改版本号 ============ */
const APP_VERSION = '2026062101';
const STORAGE_VERSION_KEY = 'zhilv_version';

/* ============ Service Worker 注册 ============ */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('./sw.js')
            .then(function(registration) {
                console.log('[SW] 注册成功:', registration.scope);
            })
            .catch(function(error) {
                console.log('[SW] 注册失败:', error);
            });
    });
}

/* ============ Agnes AI API 配置 ============ */
const AGNES_CONFIG = {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-tIQbtS4899pY8zv4mtL7iAf5nBLpD6NY5AWVv8ho4vADZxZb',
    model: 'agnes-2.0-flash'
};

/* ============ 本地存储（闹钟 / 作息 / 记忆 / 统计） ============ */
const STORAGE_KEY = 'zhilv_data_v1';

/* ============ 数据迁移函数 ============ */
function migrateData(data) {
    let migrated = false;
    
    // 确保基础字段存在
    if (!data.alarms) { data.alarms = []; migrated = true; }
    if (!data.schedule) { data.schedule = []; migrated = true; }
    if (!data.memory) { data.memory = []; migrated = true; }
    if (!data.stats) { data.stats = {}; migrated = true; }
    
    // 迁移闹钟数据格式
    if (data.alarms && data.alarms.length > 0) {
        data.alarms = data.alarms.map(alarm => {
            return {
                id: alarm.id || 'alarm_' + Date.now() + Math.random().toString(36).slice(2, 6),
                time: alarm.time || '08:00:00',
                name: alarm.name || '闹钟',
                enabled: alarm.enabled !== undefined ? alarm.enabled : true,
                repeat: alarm.repeat || 'daily',
                customDays: alarm.customDays || [],
                vibrate: alarm.vibrate || false,
                tone: alarm.tone || 'classic'
            };
        });
    }
    
    // 如果没有默认闹钟，添加示例
    if (data.alarms.length === 0) {
        data.alarms = [
            buildAlarmData('07:00:00', '工作日', true),
            buildAlarmData('12:30:00', '每日', true),
            buildAlarmData('22:30:00', '每日', false)
        ];
        migrated = true;
    }
    
    return { data, migrated };
}

function loadData() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            let data = JSON.parse(raw);
            const { data: migratedData, migrated } = migrateData(data);
            if (migrated) {
                data = migratedData;
                console.log('[智律小管家] 数据已迁移');
                saveData(data);
            }
            return data;
        }
    } catch (e) {
        console.error('[智律小管家] 数据加载失败:', e);
    }
    
    // 首次访问
    const defaults = {
        alarms: [
            buildAlarmData('07:00:00', '工作日', true),
            buildAlarmData('12:30:00', '每日', true),
            buildAlarmData('22:30:00', '每日', false)
        ],
        schedule: [],
        memory: [],
        stats: {},
        customRingtones: []  // 自定义铃声库：[{ id, name, data, duration, createdAt }]
    };
    
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
        localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION);
    } catch (e) {}
    
    return defaults;
}

function saveData(data) {
    try {
        const serialized = JSON.stringify(data);
        localStorage.setItem(STORAGE_KEY, serialized);
        localStorage.setItem(STORAGE_VERSION_KEY, APP_VERSION);
    } catch (e) {
        console.error('[智律小管家] 数据保存失败:', e);
        // 空间不足时提示用户
        if (e && e.name === 'QuotaExceededError' || (e && e.message && e.message.includes('quota'))) {
            alert('⚠️ 存储空间不足！请删除一些自定义铃声或闹钟数据。\n\n自定义铃声建议使用较小的音频文件（< 500KB）。');
        } else {
            alert('⚠️ 保存数据时出错：' + (e.message || e));
        }
    }
    
    if (cloudSyncKey && firebaseDb) {
        try {
            const toUpload = JSON.parse(JSON.stringify(data));
            toUpload._syncTime = Date.now();
            toUpload._version = APP_VERSION;
            const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
            firebaseDb.ref(path).set(toUpload).catch(() => {});
        } catch (e) {}
    }
}

/* ============ 自定义铃声库管理 ============ */

// 安全地将 ArrayBuffer 转换为 base64（避免大数据栈溢出）
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB 分块处理
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, bytes.length);
        let chunkStr = '';
        for (let j = i; j < end; j++) {
            chunkStr += String.fromCharCode(bytes[j]);
        }
        binary += chunkStr;
    }
    return btoa(binary);
}

// 将 data URL 转换为 ArrayBuffer
function dataUrlToArrayBuffer(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
}

// 添加自定义铃声到库（自动截取前10秒）
async function addCustomRingtone(file) {
    try {
        // 先验证文件类型
        const isAudio = file.type && file.type.startsWith('audio/');
        if (!isAudio && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name)) {
            throw new Error('不是有效的音频文件');
        }
        
        // 读取文件为 ArrayBuffer（比 dataURL 更高效）
        const arrayBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject('文件读取失败');
            reader.readAsArrayBuffer(file);
        });
        
        // 初始化并激活 AudioContext
        if (!ringingAlarmSharedCtx) initSharedAudioContext();
        if (!ringingAlarmSharedCtx) {
            throw new Error('浏览器不支持音频处理');
        }
        
        // 确保 AudioContext 处于运行状态
        if (ringingAlarmSharedCtx.state === 'suspended') {
            try {
                await ringingAlarmSharedCtx.resume();
            } catch (e) {
                console.warn('无法激活 AudioContext:', e);
            }
        }
        
        // 解码音频（使用 Promise 模式）
        let audioBuffer;
        try {
            audioBuffer = await ringingAlarmSharedCtx.decodeAudioData(arrayBuffer.slice(0));
        } catch (decodeErr) {
            console.error('音频解码失败:', decodeErr);
            throw new Error('音频格式不支持或文件已损坏');
        }
        
        // 截取前10秒
        const sampleRate = audioBuffer.sampleRate;
        const startSample = 0;
        const maxEndSample = Math.floor(10 * sampleRate);
        const endSample = Math.min(maxEndSample, audioBuffer.length);
        const clipLength = endSample - startSample;
        
        if (clipLength <= 0) {
            throw new Error('音频太短');
        }
        
        // 创建新的 AudioBuffer
        const clippedBuffer = ringingAlarmSharedCtx.createBuffer(
            audioBuffer.numberOfChannels,
            clipLength,
            sampleRate
        );
        
        // 复制音频数据
        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const destData = clippedBuffer.getChannelData(channel);
            for (let i = 0; i < clipLength; i++) {
                destData[i] = sourceData[startSample + i];
            }
        }
        
        // 编码为 WAV 并转 base64
        const wavBuffer = audioBufferToWav(clippedBuffer);
        const base64Data = arrayBufferToBase64(wavBuffer);
        const dataUrl = 'data:audio/wav;base64,' + base64Data;
        
        const ringtone = {
            id: 'ringtone_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
            name: file.name.replace(/\.[^/.]+$/, ''),
            data: dataUrl,
            duration: clipLength / sampleRate,
            createdAt: Date.now()
        };
        
        // 保存到铃声库
        const data = loadData();
        data.customRingtones = data.customRingtones || [];
        data.customRingtones.push(ringtone);
        saveData(data);
        
        // 预加载以便播放
        preloadCustomTone(dataUrl);
        
        return ringtone;
    } catch (error) {
        console.error('添加铃声失败:', error);
        throw error;
    }
}

// AudioBuffer 转 WAV 格式
function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = buffer.length * blockAlign;
    const bufferSize = 44 + dataSize;
    
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);
    
    // RIFF 头
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    
    // fmt 子块
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt 块大小
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    
    // data 子块
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // 交错写入音频样本
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            let sample = buffer.getChannelData(channel)[i];
            // 限制在 -1 到 1 之间
            sample = Math.max(-1, Math.min(1, sample));
            // 转换为 16-bit 整数
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }
    }
    
    return arrayBuffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// 从铃声库获取铃声
function getCustomRingtoneById(ringtoneId) {
    const data = loadData();
    return (data.customRingtones || []).find(r => r.id === ringtoneId);
}

// 删除自定义铃声
function deleteCustomRingtone(ringtoneId) {
    const data = loadData();
    data.customRingtones = (data.customRingtones || []).filter(r => r.id !== ringtoneId);
    saveData(data);
}

// 获取所有铃声选项（内置 + 自定义）
function getAllRingtoneOptions() {
    const data = loadData();
    const customRingtones = data.customRingtones || [];
    
    return [
        ...RINGTONE_OPTIONS.slice(0, -1), // 内置铃声（去掉最后一个 'custom' 占位）
        ...customRingtones.map(r => ({
            id: r.id,
            icon: '🎵',
            name: r.name.length > 8 ? r.name.substring(0, 8) + '...' : r.name,
            custom: true,
            fullName: r.name,
            data: r.data
        }))
    ];
}
function buildAlarmData(timeStr, label, enabled) {
    return {
        id: 'alarm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        time: timeStr || '00:00:00',        // HH:MM:SS
        name: label || '新闹钟',
        enabled: enabled !== false,
        repeat: 'daily',                      // daily | workday | weekend | once | custom
        customDays: [],                       // 0=周日 ... 6=周六
        vibrate: false,
        tone: 'classic',                      // 向后兼容：内置铃声名或 'custom'
        toneId: 'classic',                    // 铃声ID：内置铃声ID 或 自定义铃声库中的ID
        customToneName: '',                   // 向后兼容：旧版自定义铃声名
        customToneData: ''                    // 向后兼容：旧版自定义铃声数据
    };
}

// 把 HH:MM:SS 切出 [小时, 分钟, 秒]
function parseTime(timeStr) {
    const parts = String(timeStr || '00:00:00').split(':').map(s => parseInt(s, 10) || 0);
    return { h: parts[0] || 0, m: parts[1] || 0, s: parts[2] || 0 };
}

// 把 0~23 小时转成 am / pm 描述（纯 UI 用）
function periodOfHour(hour) {
    return hour < 12 ? 'am' : 'pm';
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

/* ============ 闹钟响铃全屏提示 + 贪睡功能 ============ */
let ringingAlarmId = null;
let ringingAlarmAudioCtx = null;    // 用于自定义铃声：保存 AudioBufferSourceNode 或 Audio 对象
let ringingAlarmSharedCtx = null;   // 共享 AudioContext（预加载 + 预热）
let ringingIntervalId = null;

// 预加载自定义铃声的 AudioBuffer（避免响铃时才解码）
let customToneBuffer = null;
let customToneDataKey = '';

// 创建并预热共享 AudioContext：监听首次用户交互后 resume()
function initSharedAudioContext() {
    if (ringingAlarmSharedCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ringingAlarmSharedCtx = new AC();
    
    // 在首次用户交互时 resume
    const resume = () => {
        if (ringingAlarmSharedCtx && ringingAlarmSharedCtx.state === 'suspended') {
            ringingAlarmSharedCtx.resume().catch(() => {});
        }
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
    document.addEventListener('touchstart', resume, { once: true });
}

// 预解码自定义铃声为 AudioBuffer，避免闹钟响铃时才解码导致延迟/失败
async function preloadCustomTone(customData) {
    if (!ringingAlarmSharedCtx) initSharedAudioContext();
    if (!ringingAlarmSharedCtx || !customData) { customToneBuffer = null; return; }
    
    // 同一份数据无需重复解码
    if (customToneDataKey === customData && customToneBuffer) return;
    
    customToneBuffer = null;
    customToneDataKey = customData;
    
    try {
        // Base64 data URL -> ArrayBuffer
        const arrayBuffer = dataUrlToArrayBuffer(customData);
        // 解码为 AudioBuffer（使用 Promise 模式）
        customToneBuffer = await ringingAlarmSharedCtx.decodeAudioData(arrayBuffer.slice(0));
    } catch (e) {
        console.warn('[自定义铃声] 解码失败，将使用内置铃声:', e);
        customToneBuffer = null;
    }
}

function triggerAlarm(alarm) {
    const t = parseTime(alarm.time);
    const showTime = String(t.h).padStart(2, '0') + ':' + String(t.m).padStart(2, '0');

    // 显示全屏响铃提示
    const overlay = document.getElementById('alarmRingingOverlay');
    const timeEl = document.getElementById('alarmRingingTime');
    const nameEl = document.getElementById('alarmRingingName');
    if (overlay) {
        overlay.style.display = 'flex';
        if (timeEl) timeEl.textContent = showTime;
        if (nameEl) nameEl.textContent = alarm.name || '闹钟';
    }
    ringingAlarmId = alarm.id;

    // 系统通知
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('⏰ 智律小管家', {
                body: (alarm.name || '闹钟') + ' - ' + showTime + ' 时间到了！',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>',
                requireInteraction: true
            });
        } catch (e) {}
    }

    // 震动
    if (alarm.vibrate && navigator.vibrate) {
        try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }

    // 播放循环提示音
    startRingingSound(alarm.tone, alarm.customToneData);
}

function startRingingSound(tone, customData) {
    // 确保共享 AudioContext 存在并已激活
    if (!ringingAlarmSharedCtx) initSharedAudioContext();
    if (!ringingAlarmSharedCtx) return;
    
    // 强制 resume（闹钟触发时是无用户交互的，需要之前有过交互才会激活）
    if (ringingAlarmSharedCtx.state === 'suspended') {
        ringingAlarmSharedCtx.resume().catch(() => {});
    }
    
    const ctx = ringingAlarmSharedCtx;
    
    // ============ 自定义铃声：通过 AudioBufferSourceNode 播放（经过同一预热通道） ============
    if (tone === 'custom' && customData) {
        const playCustom = () => {
            if (!customToneBuffer) return;
            try {
                const source = ctx.createBufferSource();
                source.buffer = customToneBuffer;
                source.loop = true;
                const gain = ctx.createGain();
                gain.gain.value = 0.5;
                source.connect(gain);
                gain.connect(ctx.destination);
                source.start(0);
                ringingAlarmAudioCtx = source; // 用这个变量存 source 以便停止
                ringingIntervalId = 'custom';   // 标记为自定义铃声模式
            } catch (e) {
                console.warn('[自定义铃声] 播放失败，转用内置铃声:', e);
                // 失败回退到内置经典铃声
                playBuiltinTone('classic');
            }
        };
        
        // 如果 buffer 已预解码，直接播放；否则先解码再播放
        if (customToneBuffer && customToneDataKey === customData) {
            playCustom();
        } else {
            // 异步解码后播放
            preloadCustomTone(customData).then(() => {
                if (customToneBuffer) {
                    playCustom();
                } else {
                    // 解码失败 → 回退到内置铃声
                    playBuiltinTone('classic');
                }
            });
        }
        return;
    }
    
    // ============ 内置铃声：振荡器（已预热，可正常播放） ============
    playBuiltinTone(tone);
}

// 内置铃声播放（振荡器循环）
function playBuiltinTone(tone) {
    const ctx = ringingAlarmSharedCtx;
    if (!ctx) return;
    
    const freqs = {
        classic: [880, 660, 880, 660],
        birds:   [1200, 1800, 1200, 1800],
        digital: [440, 880, 440, 880],
        nature:  [330, 220, 330, 220],
        chime:   [1320, 1320, 1320, 1320],
        rooster: [700, 900, 700, 1100]
    };
    const seq = freqs[tone] || freqs.classic;
    const intervalMs = seq.length * 250 + 500;

    ringingAlarmAudioCtx = ctx; // 标记为内置铃声模式
    ringingIntervalId = setInterval(() => {
        try {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type = 'sine';
            let t = ctx.currentTime;
            g.gain.setValueAtTime(0.0001, t);
            seq.forEach((f, i) => {
                o.frequency.setValueAtTime(f, t + i * 0.2);
                g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.2 + 0.02);
                g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.2 + 0.18);
            });
            o.start();
            o.stop(t + seq.length * 0.2 + 0.1);
        } catch (e) {}
    }, intervalMs);
}

function stopRingingSound() {
    // 停止自定义铃声（AudioBufferSourceNode）
    if (ringingAlarmAudioCtx && ringingAlarmAudioCtx !== ringingAlarmSharedCtx) {
        try {
            if (typeof ringingAlarmAudioCtx.stop === 'function') {
                ringingAlarmAudioCtx.stop();
            }
        } catch (e) {}
    }
    ringingAlarmAudioCtx = null;
    
    // 停止内置铃声的定时器
    if (ringingIntervalId && ringingIntervalId !== 'custom') {
        clearInterval(ringingIntervalId);
    }
    ringingIntervalId = null;
}

function snoozeAlarm() {
    if (!ringingAlarmId) return;
    const data = loadData();
    const alarm = (data.alarms || []).find(a => a.id === ringingAlarmId);
    if (!alarm) return;

    // 贪睡 5 分钟：把闹钟时间往后推 5 分钟
    const t = parseTime(alarm.time);
    let newMin = t.m + 5;
    let newHour = t.h;
    if (newMin >= 60) {
        newMin = newMin % 60;
        newHour = (newHour + 1) % 24;
    }
    alarm.time = String(newHour).padStart(2, '0') + ':' + String(newMin).padStart(2, '0') + ':' + String(t.s).padStart(2, '0');
    alarm.name = (alarm.name || '闹钟') + ' (贪睡)';
    saveData(data);
    renderSavedAlarms();

    // 关闭响铃界面
    stopRingingSound();
    const overlay = document.getElementById('alarmRingingOverlay');
    if (overlay) overlay.style.display = 'none';
    ringingAlarmId = null;

    // 提示用户
    const newShowTime = String(newHour).padStart(2, '0') + ':' + String(newMin).padStart(2, '0');
    alert('闹钟已延迟 5 分钟，将在 ' + newShowTime + ' 再次响铃');
}

function stopAlarm() {
    stopRingingSound();
    const overlay = document.getElementById('alarmRingingOverlay');
    if (overlay) overlay.style.display = 'none';
    ringingAlarmId = null;
}

function playAlarmSound(tone, customData) {
    try {
        // 如果是自定义铃声，播放上传的音频
        if (tone === 'custom' && customData) {
            const audio = new Audio(customData);
            audio.volume = 0.5;
            audio.play().catch(() => {});
            return;
        }
        
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
        const placeholder = repeatLabel(alarm); // 占位符：重复方式
        const note = alarm.note || ''; // 用户手动输入的备注
        const enabledClass = alarm.enabled ? 'on' : '';
        const dimStyle = alarm.enabled ? '' : 'opacity:0.55;';
        return (
            '<div class="alarm-card" data-id="' + alarm.id + '" style="' + dimStyle + '">' +
            '  <div class="alarm-card-left">' +
            '    <div class="alarm-card-time">' +
            '      <span class="alarm-card-period">' + period + '</span>' +
            '      <span class="alarm-card-time-main">' + timeShow + '</span>' +
            '    </div>' +
            '    <input type="text" class="alarm-card-note-input" data-action="edit-note" data-id="' + alarm.id + '"' +
            '      value="' + (note ? note.replace(/"/g, '&quot;') : '') + '"' +
            '      placeholder="' + placeholder + '"' +
            '      maxlength="20" title="手动输入备注，例如：起床提醒">' +
            '  </div>' +
            '  <div class="alarm-card-right">' +
            '    <div class="alarm-card-switch ' + enabledClass + '" data-action="toggle" data-id="' + alarm.id + '">' +
            '      <span class="switch-label switch-label-off">OFF</span>' +
            '      <div class="alarm-card-switch-thumb"></div>' +
            '      <span class="switch-label switch-label-on">ON</span>' +
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
        // 1. 点击事件（处理开关）
        listEl.addEventListener('click', function (e) {
            // 优先检测：开关点击（ON/OFF 切换）
            const sw = e.target.closest('.alarm-card-switch');
            if (sw && sw.dataset.action === 'toggle') {
                e.preventDefault();
                e.stopPropagation();
                sw.classList.toggle('on');
                const card = sw.closest('.alarm-card');
                if (card) {
                    card.style.opacity = sw.classList.contains('on') ? '' : '0.55';
                }
                const alarmId = sw.dataset.id;
                const data = loadData();
                const alarm = (data.alarms || []).find(a => a.id === alarmId);
                if (alarm) {
                    alarm.enabled = sw.classList.contains('on');
                    saveData(data);
                    syncAlarmsToServiceWorker();
                }
                return;
            }
            // 点击输入框 → 不打开编辑弹窗，让 input 获得焦点
            if (e.target.classList && e.target.classList.contains('alarm-card-note-input')) {
                e.stopPropagation();
                return;
            }
            // 整张卡片 → 打开编辑弹窗
            const card = e.target.closest('.alarm-card');
            if (card && card.dataset.id) {
                e.preventDefault();
                openAlarmModal(card.dataset.id);
            }
        });

        // 2. 输入框失去焦点时保存备注（input/blur）
        listEl.addEventListener('blur', function (e) {
            const input = e.target;
            if (input && input.classList && input.classList.contains('alarm-card-note-input')) {
                const alarmId = input.dataset.id;
                const data = loadData();
                const alarm = (data.alarms || []).find(a => a.id === alarmId);
                if (alarm) {
                    const value = (input.value || '').trim();
                    alarm.note = value;
                    saveData(data);
                    syncAlarmsToServiceWorker();
                    // 视觉提示
                    input.classList.add('note-saved');
                    setTimeout(() => input.classList.remove('note-saved'), 500);
                }
            }
        }, true); // 捕获阶段触发

        // 3. 回车键也触发保存
        listEl.addEventListener('keydown', function (e) {
            const input = e.target;
            if (input && input.classList && input.classList.contains('alarm-card-note-input')) {
                if (e.key === 'Enter') {
                    input.blur();
                }
            }
        });
    }

    const addBtn = document.getElementById('alarmAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function (e) {
            e.preventDefault();
            openAlarmModal(null);
        });
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
    customDays: [],
    customToneName: '',
    customToneData: ''
};

const RINGTONE_OPTIONS = [
    { id: 'classic', icon: '🔔', name: '经典' },
    { id: 'birds',   icon: '🐦', name: '鸟鸣' },
    { id: 'digital', icon: '📡', name: '电子音' },
    { id: 'nature',  icon: '🌿', name: '自然音' },
    { id: 'chime',   icon: '🎐', name: '风铃' },
    { id: 'rooster', icon: '🐓', name: '公鸡' },
    { id: 'custom',  icon: '📁', name: '自定义' }
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
            modalState.customToneName = alarm.customToneName || '';
            modalState.customToneData = alarm.customToneData || '';
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
        modalState.customToneName = '';
        modalState.customToneData = '';
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

    // 铃声（内置 + 自定义铃声库）
    const toneEl = document.getElementById('ringtoneList');
    if (toneEl) {
        const allRingtones = getAllRingtoneOptions();
        
        toneEl.innerHTML = allRingtones.map(o => {
            const isSelected = o.id === modalState.toneId;
            if (o.custom) {
                // 自定义铃声：显示删除按钮
                return '<div class="ringtone-item ringtone-item-custom' + (isSelected ? ' selected' : '') + '" data-tone="' + o.id + '" data-custom="true">' +
                       '  <span class="ringtone-icon">' + o.icon + '</span>' +
                       '  <span class="ringtone-name">' + o.name + '</span>' +
                       '  <button class="ringtone-delete-btn" data-ringtone-id="' + o.id + '" title="删除铃声">×</button>' +
                       '</div>';
            }
            return '<div class="ringtone-item' + (isSelected ? ' selected' : '') + '" data-tone="' + o.id + '">' +
                   '  <span class="ringtone-icon">' + o.icon + '</span>' +
                   '  <span class="ringtone-name">' + o.name + '</span>' +
                   '</div>';
        }).join('') + 
        // 添加铃声按钮
        '<div class="ringtone-item ringtone-item-add" data-tone="add">' +
        '  <span class="ringtone-icon">➕</span>' +
        '  <span class="ringtone-name">添加铃声</span>' +
        '  <span class="ringtone-hint">（自动截取10秒）</span>' +
        '  <input type="file" class="ringtone-file-input" accept="audio/*" style="display:none;" />' +
        '</div>';
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

    // 铃声点击（只选择，不预览播放，只有闹钟真正响铃时才播放）
    // 铃声点击（选中铃声或添加新铃声）
    document.getElementById('ringtoneList')?.addEventListener('click', function (e) {
        // 防止点击删除按钮时触发
        if (e.target.classList.contains('ringtone-delete-btn')) return;
        
        const item = e.target.closest('.ringtone-item');
        if (!item) return;
        
        const tone = item.dataset.tone;
        if (tone === 'add') {
            // 添加新铃声：打开文件选择
            const fileInput = item.querySelector('.ringtone-file-input');
            if (fileInput) fileInput.click();
            return;
        }
        
        // 选中铃声（内置或自定义）
        modalState.toneId = tone;
        // 向后兼容：设置 tone 字段
        const ringtone = getCustomRingtoneById(tone);
        if (ringtone) {
            modalState.tone = 'custom';
            modalState.customToneName = ringtone.name;
            modalState.customToneData = ringtone.data;
        } else {
            modalState.tone = tone;
            modalState.customToneName = '';
            modalState.customToneData = '';
        }
        renderModalControls();
    });

    // 删除自定义铃声
    document.getElementById('ringtoneList')?.addEventListener('click', function (e) {
        if (!e.target.classList.contains('ringtone-delete-btn')) return;
        e.preventDefault();
        e.stopPropagation();
        
        const ringtoneId = e.target.dataset.ringtoneId;
        if (!ringtoneId) return;
        
        if (!confirm('确定要删除这个铃声吗？')) return;
        
        // 删除铃声
        deleteCustomRingtone(ringtoneId);
        
        // 如果当前选中的是这个铃声，切换到默认铃声
        if (modalState.toneId === ringtoneId) {
            modalState.toneId = 'classic';
            modalState.tone = 'classic';
            modalState.customToneName = '';
            modalState.customToneData = '';
        }
        
        renderModalControls();
    });

    // 上传新铃声（自动截取前10秒）
    document.getElementById('ringtoneList')?.addEventListener('change', async function (e) {
        const fileInput = e.target.closest('.ringtone-file-input');
        if (!fileInput) return;
        
        const file = fileInput.files?.[0];
        if (!file) return;
        
        // 限制文件大小（5MB，截取后会更小）
        const MAX_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            const mb = (file.size / 1024 / 1024).toFixed(2);
            alert('⚠️ 文件太大（' + mb + ' MB）！\n\n请选择小于 5MB 的音频文件。');
            return;
        }
        
        // 验证文件类型（必须是音频）
        if (file.type && !file.type.startsWith('audio/')) {
            alert('⚠️ 请选择音频文件（MP3, WAV, OGG, M4A 等）');
            return;
        }
        
        try {
            // 添加到铃声库（自动截取前10秒）
            const ringtone = await addCustomRingtone(file);
            
            // 自动选中刚添加的铃声
            modalState.toneId = ringtone.id;
            modalState.tone = 'custom';
            modalState.customToneName = ringtone.name;
            modalState.customToneData = ringtone.data;
            
            renderModalControls();
            alert('✅ 铃声已添加！（自动截取前10秒）');
        } catch (error) {
            alert('❌ 添加铃声失败：' + error);
        }
        
        // 清空文件输入
        fileInput.value = '';
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

    const parent = container.parentElement;
    const upBtn = parent.querySelector('.scroll-up');
    const downBtn = parent.querySelector('.scroll-down');

    if (upBtn) {
        upBtn.addEventListener('click', () => {
            const current = parseInt(container.querySelector('.time-scroll-inner')?.textContent || '0', 10);
            const next = (current + 1) % max;
            onSet(next);
            setTimeText(containerId, next);
        });
    }

    if (downBtn) {
        downBtn.addEventListener('click', () => {
            const current = parseInt(container.querySelector('.time-scroll-inner')?.textContent || '0', 10);
            const next = (current - 1 + max) % max;
            onSet(next);
            setTimeText(containerId, next);
        });
    }
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
            existing.toneId = modalState.toneId;  // 保存铃声ID
            existing.repeat = modalState.repeat;
            existing.vibrate = modalState.vibrate;
            existing.customDays = modalState.customDays.slice();
            existing.customToneName = modalState.customToneName;
            existing.customToneData = modalState.customToneData;
        }
    } else {
        const newAlarm = buildAlarmData(timeStr, name, true);
        newAlarm.tone = modalState.tone;
        newAlarm.toneId = modalState.toneId;  // 保存铃声ID
        newAlarm.repeat = modalState.repeat;
        newAlarm.vibrate = modalState.vibrate;
        newAlarm.customDays = modalState.customDays.slice();
        newAlarm.customToneName = modalState.customToneName;
        newAlarm.customToneData = modalState.customToneData;
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

/* ============ 计时器模块 ============ */
let timerRunning = false;
let timerStartTime = 0;
let timerPausedTime = 0;
let timerTotalElapsed = 0;
let timerHistory = [];

function initTimer() {
    const startBtn = document.getElementById('timerStartBtn');
    const pauseBtn = document.getElementById('timerPauseBtn');
    const resetBtn = document.getElementById('timerResetBtn');

    startBtn?.addEventListener('click', () => {
        if (!timerRunning) {
            timerRunning = true;
            timerStartTime = Date.now();
            startBtn.style.display = 'none';
            pauseBtn.style.display = 'inline-block';
        }
    });

    pauseBtn?.addEventListener('click', () => {
        if (timerRunning) {
            timerRunning = false;
            timerPausedTime = Date.now();
            timerTotalElapsed += (timerPausedTime - timerStartTime);
            startBtn.style.display = 'inline-block';
            pauseBtn.style.display = 'none';
        }
    });

    resetBtn?.addEventListener('click', () => {
        if (timerTotalElapsed > 0 || timerRunning) {
            // 保存历史记录
            const elapsed = timerRunning ? (Date.now() - timerStartTime) + timerTotalElapsed : timerTotalElapsed;
            if (elapsed > 1000) {
                const secs = Math.floor(elapsed / 1000);
                const h = Math.floor(secs / 3600);
                const m = Math.floor((secs % 3600) / 60);
                const s = secs % 60;
                timerHistory.unshift({
                    time: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0'),
                    date: new Date().toLocaleString()
                });
                if (timerHistory.length > 10) timerHistory.pop();
                renderTimerHistory();
            }
        }
        timerRunning = false;
        timerStartTime = 0;
        timerPausedTime = 0;
        timerTotalElapsed = 0;
        startBtn.style.display = 'inline-block';
        pauseBtn.style.display = 'none';
        updateTimerDisplay(0);
    });
}

function updateTimerDisplay(elapsedMs) {
    const secs = Math.floor(elapsedMs / 1000);
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const display = document.getElementById('timerDisplay');
    if (display) {
        display.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
}

function renderTimerHistory() {
    const listEl = document.getElementById('timerHistoryList');
    if (!listEl) return;
    if (timerHistory.length === 0) {
        listEl.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px;">暂无记录</div>';
        return;
    }
    listEl.innerHTML = timerHistory.map(item =>
        '<div class="timer-history-item"><span>' + item.time + '</span><span>' + item.date + '</span></div>'
    ).join('');
}

function tickTimer() {
    if (timerRunning) {
        const elapsed = (Date.now() - timerStartTime) + timerTotalElapsed;
        updateTimerDisplay(elapsed);
    }
}

/* ============ 倒计时模块 ============ */
let countdownRunning = false;
let countdownPaused = false;
let countdownEndTime = 0;
let countdownRemainingMs = 0;
let countdownAudioCtx = null;

function initCountdown() {
    const startBtn = document.getElementById('countdownStartBtn');
    const pauseBtn = document.getElementById('countdownPauseBtn');
    const resetBtn = document.getElementById('countdownResetBtn');
    const endBtn = document.getElementById('countdownEndBtn');

    startBtn?.addEventListener('click', () => {
        const h = parseInt(document.getElementById('countdownHour')?.value || '0', 10);
        const m = parseInt(document.getElementById('countdownMin')?.value || '0', 10);
        const s = parseInt(document.getElementById('countdownSec')?.value || '0', 10);
        const totalMs = (h * 3600 + m * 60 + s) * 1000;
        if (totalMs <= 0) {
            alert('请设置有效的倒计时时间');
            return;
        }
        countdownRunning = true;
        countdownPaused = false;
        countdownEndTime = Date.now() + totalMs;
        countdownRemainingMs = totalMs;

        document.getElementById('countdownSetup').style.display = 'none';
        document.getElementById('countdownControls').style.display = 'flex';
        document.getElementById('countdownLabel').textContent = '倒计时进行中';
        updateCountdownDisplay(totalMs);
    });

    pauseBtn?.addEventListener('click', () => {
        if (countdownRunning && !countdownPaused) {
            countdownPaused = true;
            countdownRemainingMs = countdownEndTime - Date.now();
            pauseBtn.textContent = '▶ 继续';
        } else if (countdownRunning && countdownPaused) {
            countdownPaused = false;
            countdownEndTime = Date.now() + countdownRemainingMs;
            pauseBtn.textContent = '⏸ 暂停';
        }
    });

    resetBtn?.addEventListener('click', resetCountdown);
    endBtn?.addEventListener('click', () => {
        stopCountdownSound();
        document.getElementById('countdownEndOverlay').style.display = 'none';
        resetCountdown();
    });
}

function resetCountdown() {
    countdownRunning = false;
    countdownPaused = false;
    countdownEndTime = 0;
    countdownRemainingMs = 0;
    stopCountdownSound();

    document.getElementById('countdownSetup').style.display = 'block';
    document.getElementById('countdownControls').style.display = 'none';
    document.getElementById('countdownLabel').textContent = '设置倒计时';
    updateCountdownDisplay(0);
}

function updateCountdownDisplay(ms) {
    const secs = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const display = document.getElementById('countdownDisplay');
    if (display) {
        display.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        // 最后 10 秒警告样式
        if (secs <= 10 && secs > 0) {
            display.classList.add('warning');
        } else {
            display.classList.remove('warning');
        }
    }
}

function tickCountdown() {
    if (!countdownRunning) return;
    if (countdownPaused) {
        updateCountdownDisplay(countdownRemainingMs);
        return;
    }
    const remaining = countdownEndTime - Date.now();
    if (remaining <= 0) {
        countdownRunning = false;
        updateCountdownDisplay(0);
        showCountdownEnd();
        return;
    }
    updateCountdownDisplay(remaining);
}

function showCountdownEnd() {
    const overlay = document.getElementById('countdownEndOverlay');
    if (overlay) overlay.style.display = 'flex';
    startCountdownSound();
    // 震动
    if (navigator.vibrate) {
        try { navigator.vibrate([500, 200, 500, 200, 500]); } catch (e) {}
    }
    // 系统通知
    if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification('🎉 智律小管家', {
                body: '倒计时结束！时间到了！',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎉</text></svg>'
            });
        } catch (e) {}
    }
}

function startCountdownSound() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        countdownAudioCtx = new AC();
        const freqs = [880, 990, 1100, 1210, 1320];
        freqs.forEach((f, i) => {
            const o = countdownAudioCtx.createOscillator();
            const g = countdownAudioCtx.createGain();
            o.connect(g); g.connect(countdownAudioCtx.destination);
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0.2, countdownAudioCtx.currentTime + i * 0.15);
            g.gain.exponentialRampToValueAtTime(0.0001, countdownAudioCtx.currentTime + i * 0.15 + 0.14);
            o.start(countdownAudioCtx.currentTime + i * 0.15);
            o.stop(countdownAudioCtx.currentTime + i * 0.15 + 0.15);
        });
    } catch (e) {}
}

function stopCountdownSound() {
    if (countdownAudioCtx) {
        try { countdownAudioCtx.close(); } catch (e) {}
        countdownAudioCtx = null;
    }
}

/* ============ 世界时钟模块 ============ */
const WORLD_CLOCKS = [
    { id: 'London',  offset: -7,  name: '伦敦' },
    { id: 'NewYork', offset: -12, name: '纽约' },
    { id: 'Tokyo',   offset: 1,   name: '东京' },
    { id: 'Sydney',  offset: 2,   name: '悉尼' },
    { id: 'Paris',   offset: -6,  name: '巴黎' },
    { id: 'Moscow',  offset: -5,  name: '莫斯科' }
];

function updateWorldClock() {
    const now = new Date();

    // 本地时间
    const localTimeEl = document.getElementById('worldclockLocal');
    const localDateEl = document.getElementById('worldclockLocalDate');
    if (localTimeEl) {
        localTimeEl.textContent =
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');
    }
    if (localDateEl) {
        localDateEl.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
    }

    // 各城市时间
    WORLD_CLOCKS.forEach(city => {
        const timeEl = document.getElementById('wc' + city.id);
        const dateEl = document.getElementById('wc' + city.id + 'Date');
        if (!timeEl) return;

        // 计算城市时间（北京时间 + offset）
        let cityHour = now.getHours() + city.offset;
        let cityDate = new Date(now);

        // 处理跨日
        if (cityHour < 0) {
            cityHour += 24;
            cityDate.setDate(cityDate.getDate() - 1);
        } else if (cityHour >= 24) {
            cityHour -= 24;
            cityDate.setDate(cityDate.getDate() + 1);
        }

        timeEl.textContent =
            String(cityHour).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0');

        if (dateEl) {
            dateEl.textContent = cityDate.getFullYear() + '/' + (cityDate.getMonth() + 1) + '/' + cityDate.getDate();
        }
    });
}

/* ============ 闹钟子面板切换（闹钟/计时/倒计时/世界时钟） ============ */
function switchAlarmPanel(sub) {
    // 子导航按钮激活状态
    document.querySelectorAll('.alarm-subnav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sub === sub);
    });
    // 子面板显示状态
    document.querySelectorAll('.alarm-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.sub === sub);
    });
}

function initAlarmSubnav() {
    document.querySelectorAll('.alarm-subnav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchAlarmPanel(btn.dataset.sub));
    });
}

/* ============ 唯一的启动入口 ============ */
document.addEventListener('DOMContentLoaded', function () {
    // 1. UI 初始化
    initIntro();
    updateDateDisplay();
    updateClockDisplay();

    // 2. 事件监听（全局 + 闹钟 + 弹窗 + 云同步 + 计时器 + 倒计时 + 响铃贪睡 + 子面板）
    initGlobalEventListeners();
    initAlarmListEventDelegation();
    initAlarmModalListeners();
    initCloudSyncEventListeners();
    initAlarmSubnav();
    initTimer();
    initCountdown();

    // 响铃贪睡按钮
    document.getElementById('alarmSnoozeBtn')?.addEventListener('click', snoozeAlarm);
    document.getElementById('alarmStopBtn')?.addEventListener('click', stopAlarm);

    // 3. 数据 / 权限 / SW
    renderSavedAlarms();
    renderTimerHistory();
    requestNotificationPermission();
    registerServiceWorker();
    initCloudSync();
    
    // 4. 音频初始化（预热 AudioContext，确保自定义铃声可播放）
    initSharedAudioContext();
    // 加载已有自定义铃声数据（如果有）
    const data = loadData();
    if (data && data.alarms) {
        for (const alarm of data.alarms) {
            if (alarm.tone === 'custom' && alarm.customToneData) {
                preloadCustomTone(alarm.customToneData);
                break;
            }
        }
    }

    // 4. 定时任务
    setInterval(updateClockDisplay, 1000);   // 每秒刷新顶部时钟
    setInterval(checkAlarms, 1000);          // 每秒检查闹钟
    setInterval(tickTimer, 100);             // 计时器刷新（100ms）
    setInterval(tickCountdown, 100);         // 倒计时刷新（100ms）
    setInterval(updateWorldClock, 1000);     // 世界时钟刷新
    setInterval(syncAlarmsToServiceWorker, 5 * 60 * 1000); // 每 5 分钟同步到 SW

    // 初始化世界时钟
    updateWorldClock();

    // 5. 日历
    initCalendar();
});

/* ============ 日历作息表 ============ */

// 农历数据
const LUNAR_MONTHS = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
const LUNAR_DAYS = ['', '初', '十', '廿', '三'];
const LUNAR_DAY_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 节假日数据（2024-2028年）
const HOLIDAYS = {
    '2024-01-01': '元旦',
    '2024-02-09': '除夕',
    '2024-02-10': '春节',
    '2024-02-11': '春节',
    '2024-02-12': '春节',
    '2024-04-04': '清明节',
    '2024-05-01': '劳动节',
    '2024-05-02': '劳动节',
    '2024-05-03': '劳动节',
    '2024-06-10': '端午节',
    '2024-09-15': '中秋节',
    '2024-10-01': '国庆节',
    '2024-10-02': '国庆节',
    '2024-10-03': '国庆节',
    '2024-10-04': '国庆节',
    '2024-10-05': '国庆节',
    
    '2025-01-01': '元旦',
    '2025-01-28': '除夕',
    '2025-01-29': '春节',
    '2025-01-30': '春节',
    '2025-01-31': '春节',
    '2025-04-05': '清明节',
    '2025-05-01': '劳动节',
    '2025-05-02': '劳动节',
    '2025-05-03': '劳动节',
    '2025-06-02': '端午节',
    '2025-09-07': '中秋节',
    '2025-10-01': '国庆节',
    '2025-10-02': '国庆节',
    '2025-10-03': '国庆节',
    '2025-10-04': '国庆节',
    '2025-10-05': '国庆节',
    
    '2026-01-01': '元旦',
    '2026-02-16': '除夕',
    '2026-02-17': '春节',
    '2026-02-18': '春节',
    '2026-02-19': '春节',
    '2026-04-04': '清明节',
    '2026-05-01': '劳动节',
    '2026-05-02': '劳动节',
    '2026-05-03': '劳动节',
    '2026-06-19': '端午节',
    '2026-09-26': '中秋节',
    '2026-10-01': '国庆节',
    '2026-10-02': '国庆节',
    '2026-10-03': '国庆节',
    '2026-10-04': '国庆节',
    '2026-10-05': '国庆节',
    
    '2027-01-01': '元旦',
    '2027-02-05': '除夕',
    '2027-02-06': '春节',
    '2027-02-07': '春节',
    '2027-02-08': '春节',
    '2027-04-04': '清明节',
    '2027-05-01': '劳动节',
    '2027-05-02': '劳动节',
    '2027-05-03': '劳动节',
    '2027-06-08': '端午节',
    '2027-09-15': '中秋节',
    '2027-10-01': '国庆节',
    '2027-10-02': '国庆节',
    '2027-10-03': '国庆节',
    '2027-10-04': '国庆节',
    '2027-10-05': '国庆节',
    
    '2028-01-01': '元旦',
    '2028-01-25': '除夕',
    '2028-01-26': '春节',
    '2028-01-27': '春节',
    '2028-01-28': '春节',
    '2028-04-04': '清明节',
    '2028-05-01': '劳动节',
    '2028-05-02': '劳动节',
    '2028-05-03': '劳动节',
    '2028-05-28': '端午节',
    '2028-09-25': '中秋节',
    '2028-10-01': '国庆节',
    '2028-10-02': '国庆节',
    '2028-10-03': '国庆节',
    '2028-10-04': '国庆节',
    '2028-10-05': '国庆节',

    // 固定节日
    '01-01': '元旦',
    '03-08': '妇女节',
    '03-12': '植树节',
    '05-04': '青年节',
    '06-01': '儿童节',
    '07-01': '建党节',
    '08-01': '建军节',
    '09-10': '教师节',
    '12-25': '圣诞节',
    '06-21': '夏至',
    '12-21': '冬至',
    '06-06': '芒种'
};

// 二十四节气
const SOLAR_TERMS = {
    '01-05': '小寒', '01-20': '大寒',
    '02-04': '立春', '02-19': '雨水',
    '03-05': '惊蛰', '03-20': '春分',
    '04-04': '清明', '04-20': '谷雨',
    '05-05': '立夏', '05-21': '小满',
    '06-05': '芒种', '06-21': '夏至',
    '07-07': '小暑', '07-23': '大暑',
    '08-07': '立秋', '08-23': '处暑',
    '09-07': '白露', '09-23': '秋分',
    '10-08': '寒露', '10-23': '霜降',
    '11-07': '立冬', '11-22': '小雪',
    '12-07': '大雪', '12-22': '冬至'
};

let currentYear = 2026;
let currentMonth = 5;

function initCalendar() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();

    bindCalendarEvents();
    renderCalendar();
}

function bindCalendarEvents() {
    const yearSelect = document.getElementById('calYearSelect');
    const monthSelect = document.getElementById('calMonthSelect');
    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');
    const todayBtn = document.getElementById('calTodayBtn');

    if (yearSelect) yearSelect.addEventListener('change', () => {
        currentYear = parseInt(yearSelect.value, 10);
        renderCalendar();
    });

    if (monthSelect) monthSelect.addEventListener('change', () => {
        currentMonth = parseInt(monthSelect.value, 10);
        renderCalendar();
    });

    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (currentMonth === 0) {
            currentMonth = 11;
            currentYear--;
        } else {
            currentMonth--;
        }
        updateSelects();
        renderCalendar();
    });

    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (currentMonth === 11) {
            currentMonth = 0;
            currentYear++;
        } else {
            currentMonth++;
        }
        updateSelects();
        renderCalendar();
    });

    if (todayBtn) todayBtn.addEventListener('click', () => {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        updateSelects();
        renderCalendar();
    });
}

function updateSelects() {
    const yearSelect = document.getElementById('calYearSelect');
    const monthSelect = document.getElementById('calMonthSelect');
    if (yearSelect) yearSelect.value = currentYear;
    if (monthSelect) monthSelect.value = currentMonth;
}

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKey(date) {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getLunarDate(date) {
    const lunarInfo = getLunarInfo(date);
    return lunarInfo;
}

function getLunarInfo(date) {
    const day = date.getDate();
    let lunarDay = '';
    if (day <= 10) {
        lunarDay = LUNAR_DAYS[1] + LUNAR_DAY_NUMS[day];
    } else if (day < 20) {
        lunarDay = LUNAR_DAYS[2] + LUNAR_DAY_NUMS[day - 10];
    } else if (day === 20) {
        lunarDay = '二十';
    } else if (day < 30) {
        lunarDay = LUNAR_DAYS[3] + LUNAR_DAY_NUMS[day - 20];
    } else {
        lunarDay = '三十';
    }
    return lunarDay;
}

function getHoliday(date) {
    const fullDate = formatDate(date);
    const dateKey = formatDateKey(date);
    
    if (HOLIDAYS[fullDate]) return HOLIDAYS[fullDate];
    if (SOLAR_TERMS[dateKey]) return SOLAR_TERMS[dateKey];
    if (HOLIDAYS[dateKey]) return HOLIDAYS[dateKey];
    return '';
}

function isHoliday(date) {
    const fullDate = formatDate(date);
    const dateKey = formatDateKey(date);
    const dayOfWeek = date.getDay();
    
    if (HOLIDAYS[fullDate]) return true;
    if (dayOfWeek === 0 || dayOfWeek === 6) return true;
    return false;
}

function isWeekend(date) {
    const dayOfWeek = date.getDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
}

function renderCalendar() {
    const container = document.getElementById('calDaysContainer');
    if (!container) return;

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const today = new Date();
    const todayStr = formatDate(today);

    const startDay = firstDay.getDay();
    const totalDays = lastDay.getDate();

    let html = '';

    // 上月日期
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    const prevMonthDays = new Date(currentYear, currentMonth - 1, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
        const d = prevMonthLastDay - i;
        const date = new Date(currentYear, currentMonth - 1, d);
        if (d <= prevMonthDays) {
            html += renderDay(date, true);
        } else {
            html += '<div class="calendar-day empty"></div>';
        }
    }

    // 当月日期
    for (let d = 1; d <= totalDays; d++) {
        const date = new Date(currentYear, currentMonth, d);
        html += renderDay(date, false);
    }

    // 下月日期
    const remaining = 42 - (startDay + totalDays);
    const nextMonthDays = new Date(currentYear, currentMonth + 2, 0).getDate();
    for (let d = 1; d <= remaining; d++) {
        if (d <= nextMonthDays) {
            const date = new Date(currentYear, currentMonth + 1, d);
            html += renderDay(date, true);
        } else {
            html += '<div class="calendar-day empty"></div>';
        }
    }

    container.innerHTML = html;
}

function renderDay(date, isOtherMonth) {
    const dateStr = formatDate(date);
    const isToday = dateStr === formatDate(new Date());
    const holiday = getHoliday(date);
    const isHol = isHoliday(date);
    const lunar = getLunarDate(date);
    const dayOfWeek = date.getDay();
    const isSat = dayOfWeek === 6;
    const isSun = dayOfWeek === 0;

    let classes = ['calendar-day'];
    if (isOtherMonth) classes.push('other-month');
    if (isToday) classes.push('today');
    if (isHol) classes.push('holiday');
    if (isHol && !isOtherMonth) classes.push('has-rest');
    if (!isOtherMonth) classes.push('clickable');

    let dateColor = '';
    if (isSun || isSat) dateColor = 'color: #e74c3c;';

    let onclick = !isOtherMonth ? `onclick="showDaySchedule('${dateStr}')"` : '';

    let html = `<div class="${classes.join(' ')}" data-date="${dateStr}" ${onclick}>`;
    
    // 休标签（左上角）
    if (isHol && !isOtherMonth) {
        html += '<span class="day-rest-tag">休</span>';
    }
    
    // 日期数字
    html += `<span class="day-date" style="${dateColor}">${date.getDate()}</span>`;
    
    // 农历 + 节日名称（日期下方）
    if (!isOtherMonth) {
        html += `<span class="day-lunar">${lunar}</span>`;
        if (holiday) {
            html += `<span class="day-holiday-tag">${holiday}</span>`;
        }
    }
    
    html += '</div>';
    
    return html;
}

/* ============ 作息计划数据与渲染 ============ */
const DEFAULT_SCHEDULE = [
    { time: '07:00', label: '起床·晨间活动', period: 'morning', checked: false },
    { time: '09:00', label: '工作/学习', period: 'morning', checked: false },
    { time: '12:30', label: '午餐·午休', period: 'afternoon', checked: false },
    { time: '14:00', label: '下午专注工作', period: 'afternoon', checked: false },
    { time: '18:00', label: '晚餐·运动', period: 'evening', checked: false },
    { time: '22:30', label: '准备入睡', period: 'night', checked: false }
];

function getPeriod(hour) {
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 18) return 'afternoon';
    if (hour >= 18 && hour < 22) return 'evening';
    return 'night';
}

function formatDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

let currentScheduleDate = '';

function showDaySchedule(dateStr) {
    currentScheduleDate = dateStr;
    const date = new Date(dateStr);
    const todayStr = formatDate(new Date());
    
    // 切换到每日作息页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-day-schedule').classList.add('active');
    
    // 更新导航栏
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector('.nav-btn[data-page="schedule"]').classList.add('active');
    
    // 渲染日期信息
    const titleEl = document.getElementById('dayScheduleTitle');
    const dateTextEl = document.getElementById('dayDateText');
    const lunarTextEl = document.getElementById('dayLunarText');
    
    const isToday = dateStr === todayStr;
    titleEl.textContent = isToday ? '今日作息' : `${date.getMonth() + 1}月${date.getDate()}日作息`;
    
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    dateTextEl.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayNames[date.getDay()]}`;
    lunarTextEl.textContent = getLunarDate(date);
    
    renderScheduleList();
    window.scrollTo(0, 0);
}

function getScheduleData(dateStr) {
    const saved = localStorage.getItem(`schedule_data_${dateStr}`);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            // 确保每条数据有score字段
            return data.map(item => ({
                time: item.time,
                label: item.label,
                checked: item.checked,
                score: item.score || 0
            }));
        } catch (e) {}
    }
    // 默认数据
    return [
        { time: '07:00', label: '起床·晨间活动', checked: false, score: 0 },
        { time: '09:00', label: '工作/学习', checked: false, score: 0 },
        { time: '12:30', label: '午餐·午休', checked: false, score: 0 },
        { time: '14:00', label: '下午专注工作', checked: false, score: 0 },
        { time: '18:00', label: '晚餐·运动', checked: false, score: 0 },
        { time: '22:30', label: '准备入睡', checked: false, score: 0 }
    ];
}

function saveScheduleData(dateStr, data) {
    localStorage.setItem(`schedule_data_${dateStr}`, JSON.stringify(data));
}

function renderScheduleList() {
    const dateStr = currentScheduleDate;
    const scheduleListEl = document.getElementById('dayScheduleList');
    const items = getScheduleData(dateStr);
    
    // 计算统计数据
    updateScheduleStats(items);
    
    let html = '';
    items.forEach((item, idx) => {
        const hour = parseInt(item.time.split(':')[0]);
        const period = getPeriod(hour);
        const checkedClass = item.checked ? 'checked' : '';
        const itemScore = item.score || 0;
        
        html += `
            <div class="day-schedule-item" data-idx="${idx}">
                <input type="time" class="day-schedule-time-input" value="${item.time}"
                    onchange="updateScheduleTime(${idx}, this.value)"
                    onclick="event.stopPropagation()">
                <span class="day-schedule-dot ${period}"></span>
                <input type="text" class="day-schedule-label-input" value="${item.label}"
                    placeholder="输入作息内容..."
                    onchange="updateScheduleLabel(${idx}, this.value)"
                    onclick="event.stopPropagation()">
                <input type="number" class="day-schedule-score-input" value="${itemScore}"
                    min="0" max="100" step="1"
                    placeholder="得分"
                    onchange="updateScheduleScore(${idx}, this.value)"
                    onclick="event.stopPropagation()">
                <button class="day-schedule-delete-btn" onclick="deleteScheduleItem(${idx}); event.stopPropagation();">
                    ×
                </button>
                <span class="day-schedule-check ${checkedClass}" onclick="toggleScheduleItem(${idx}); event.stopPropagation();"></span>
            </div>
        `;
    });
    
    // 添加按钮
    html += `
        <button class="day-schedule-add-btn" onclick="addScheduleItem()">
            + 添加新作息
        </button>
    `;
    
    scheduleListEl.innerHTML = html;
}

function updateScheduleStats(items) {
    const total = items.length;
    const completed = items.filter(item => item.checked).length;
    
    // 完成情况（百分比）
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    document.getElementById('statCompletion').textContent = completionRate + '%';
    
    // 完成件数
    document.getElementById('statCount').textContent = completed + '/' + total;
    
    // 打分情况：得分 = 所有件数得分之和 / 总件数
    if (total > 0) {
        const totalScore = items.reduce((sum, item) => sum + (parseInt(item.score) || 0), 0);
        const avgScore = Math.round(totalScore / total);
        document.getElementById('statScore').textContent = avgScore + '分';
    } else {
        document.getElementById('statScore').textContent = '-';
    }
}

function updateScheduleTime(idx, newTime) {
    const items = getScheduleData(currentScheduleDate);
    if (items[idx]) {
        items[idx].time = newTime;
        saveScheduleData(currentScheduleDate, items);
        renderScheduleList();
    }
}

function updateScheduleLabel(idx, newLabel) {
    const items = getScheduleData(currentScheduleDate);
    if (items[idx]) {
        items[idx].label = newLabel.trim() || '未命名';
        saveScheduleData(currentScheduleDate, items);
    }
}

function updateScheduleScore(idx, newScore) {
    const items = getScheduleData(currentScheduleDate);
    if (items[idx]) {
        let score = parseInt(newScore);
        if (isNaN(score) || score < 0) score = 0;
        if (score > 100) score = 100;
        items[idx].score = score;
        saveScheduleData(currentScheduleDate, items);
        updateScheduleStats(items);
    }
}

function toggleScheduleItem(idx) {
    const items = getScheduleData(currentScheduleDate);
    if (items[idx]) {
        items[idx].checked = !items[idx].checked;
        saveScheduleData(currentScheduleDate, items);
        renderScheduleList();
    }
}

function deleteScheduleItem(idx) {
    if (!confirm('确认删除这条作息计划？')) return;
    const items = getScheduleData(currentScheduleDate);
    items.splice(idx, 1);
    saveScheduleData(currentScheduleDate, items);
    renderScheduleList();
}

function addScheduleItem() {
    const items = getScheduleData(currentScheduleDate);
    items.push({ time: '12:00', label: '新作息', checked: false, score: 0 });
    saveScheduleData(currentScheduleDate, items);
    renderScheduleList();
}

function showCalendarPage() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-schedule').classList.add('active');
}

function showStatsChart(type) {
    const modal = document.getElementById('statsChartModal');
    const titleEl = document.getElementById('chartModalTitle');
    const contentEl = document.getElementById('chartModalContent');
    
    if (type === 'pie') {
        titleEl.textContent = '饼形图 - 完成情况分析';
        contentEl.innerHTML = renderPieChart();
    } else if (type === 'line') {
        titleEl.textContent = '折线图 - 得分趋势';
        contentEl.innerHTML = renderLineChart();
    }
    
    modal.classList.add('active');
}

function closeStatsChart() {
    document.getElementById('statsChartModal').classList.remove('active');
}

function renderPieChart() {
    const items = getScheduleData(currentScheduleDate);
    const total = items.length;
    const completed = items.filter(item => item.checked).length;
    const uncompleted = total - completed;
    
    if (total === 0) {
        return '<div class="chart-empty">暂无数据</div>';
    }
    
    // 计算饼图角度
    const completedAngle = (completed / total) * 360;
    const uncompletedAngle = (uncompleted / total) * 360;
    
    const radius = 80;
    const circumference = 2 * Math.PI * radius;
    const completedOffset = circumference * (1 - completedAngle / 360);
    const uncompletedOffset = circumference * (1 - uncompletedAngle / 360);
    
    return `
        <div class="chart-container">
            <div class="pie-chart-wrapper">
                <svg viewBox="0 0 200 200" class="pie-chart-svg">
                    <circle cx="100" cy="100" r="${radius}" fill="#5aa8e0" stroke="none"/>
                    <circle cx="100" cy="100" r="${radius}" fill="#ffd166" stroke="none"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${completedOffset}"
                        transform="rotate(-90 100 100)"
                        style="opacity: ${uncompleted > 0 ? 1 : 0}"/>
                </svg>
                <div class="pie-chart-center">
                    <div class="pie-center-num">${Math.round((completed / total) * 100)}%</div>
                    <div class="pie-center-label">完成率</div>
                </div>
            </div>
            <div class="chart-legend">
                <div class="legend-item">
                    <span class="legend-dot" style="background:#5aa8e0"></span>
                    <span class="legend-label">已完成 ${completed} 件</span>
                </div>
                <div class="legend-item">
                    <span class="legend-dot" style="background:#ffd166"></span>
                    <span class="legend-label">未完成 ${uncompleted} 件</span>
                </div>
            </div>
        </div>
    `;
}

function renderLineChart() {
    const items = getScheduleData(currentScheduleDate);
    
    if (items.length === 0) {
        return '<div class="chart-empty">暂无数据</div>';
    }
    
    // 获取最近7天数据
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = formatDate(d);
        const dayData = getScheduleData(dateStr);
        let avgScore = 0;
        if (dayData && dayData.length > 0) {
            const totalScore = dayData.reduce((sum, item) => sum + (parseInt(item.score) || 0), 0);
            avgScore = Math.round(totalScore / dayData.length);
        }
        days.push({
            label: `${d.getMonth() + 1}/${d.getDate()}`,
            score: avgScore
        });
    }
    
    // SVG 折线图
    const width = 400;
    const height = 200;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const points = days.map((day, i) => {
        const x = padding + (chartWidth / (days.length - 1)) * i;
        const y = height - padding - (day.score / 100) * chartHeight;
        return { x, y, ...day };
    });
    
    let pathD = '';
    points.forEach((p, i) => {
        pathD += (i === 0 ? 'M' : 'L') + p.x + ',' + p.y + ' ';
    });
    
    let pointsHtml = '';
    points.forEach(p => {
        pointsHtml += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#5aa8e0"/>`;
        pointsHtml += `<text x="${p.x}" y="${p.y - 10}" text-anchor="middle" fill="#5aa8e0" font-size="12">${p.score}</text>`;
    });
    
    let xAxisLabels = '';
    points.forEach(p => {
        xAxisLabels += `<text x="${p.x}" y="${height - 10}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="11">${p.label}</text>`;
    });
    
    return `
        <div class="chart-container">
            <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg">
                <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
                <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="4"/>
                <path d="${pathD}" fill="none" stroke="#5aa8e0" stroke-width="3"/>
                ${pointsHtml}
                ${xAxisLabels}
                <text x="5" y="${padding + 5}" fill="rgba(255,255,255,0.6)" font-size="11">100分</text>
                <text x="5" y="${height - padding}" fill="rgba(255,255,255,0.6)" font-size="11">0分</text>
            </svg>
            <div class="chart-legend">
                <div class="legend-item">
                    <span class="legend-dot" style="background:#5aa8e0"></span>
                    <span class="legend-label">最近7天平均得分趋势</span>
                </div>
            </div>
        </div>
    `;
}

function showStatsChartOptions(event) {
    event.stopPropagation();
    document.getElementById('chartOptionsModal').classList.add('active');
}

function closeChartOptions(event) {
    if (!event || event.target.id === 'chartOptionsModal') {
        document.getElementById('chartOptionsModal').classList.remove('active');
    }
}
