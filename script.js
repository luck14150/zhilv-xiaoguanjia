/* ============ 智律小管家 - 核心脚本 ============
 * 说明：以 localStorage 作为闹钟数据的单一数据源。
 * DOM 只做渲染，不反向读取数据。任何改动先写回 localStorage，再重新渲染。
 */

/* ============ 版本控制 - 每次更新必须修改版本号 ============ */
const APP_VERSION = '2026062108';
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

// 铃声试听（独立变量，不影响真正响铃）
let previewSource = null;      // 自定义铃声试听的 AudioBufferSourceNode
let previewIntervalId = null;  // 内置铃声试听的定时器 ID
let previewToneDataKey = '';   // 当前试听的自定义铃声数据key
let previewBuffer = null;      // 试听专用的 AudioBuffer

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

/* ============ 铃声试听功能（不影响真正闹钟响铃） ============ */

// 停止铃声试听
function stopPreviewTone() {
    // 停止自定义铃声试听
    if (previewSource) {
        try {
            previewSource.stop();
        } catch (e) {}
        previewSource = null;
    }
    // 停止内置铃声试听的定时器
    if (previewIntervalId) {
        clearInterval(previewIntervalId);
        previewIntervalId = null;
    }
}

// 试听内置铃声（播放约3秒，不循环）
function playPreviewBuiltinTone(tone) {
    stopPreviewTone();
    
    if (!ringingAlarmSharedCtx) initSharedAudioContext();
    const ctx = ringingAlarmSharedCtx;
    if (!ctx) return;
    
    if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) {}
    }
    
    const freqs = {
        classic: [880, 660, 880, 660],
        birds:   [1200, 1800, 1200, 1800],
        digital: [440, 880, 440, 880],
        nature:  [330, 220, 330, 220],
        chime:   [1320, 1320, 1320, 1320],
        rooster: [700, 900, 700, 1100]
    };
    const seq = freqs[tone] || freqs.classic;
    
    // 只播放一个序列（约1秒），不循环
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
        
        // 3秒后再播放一次，让用户有更好的体验
        previewIntervalId = setTimeout(() => {
            try {
                const o2 = ctx.createOscillator();
                const g2 = ctx.createGain();
                o2.connect(g2); g2.connect(ctx.destination);
                o2.type = 'sine';
                let t2 = ctx.currentTime;
                g2.gain.setValueAtTime(0.0001, t2);
                seq.forEach((f, i) => {
                    o2.frequency.setValueAtTime(f, t2 + i * 0.2);
                    g2.gain.exponentialRampToValueAtTime(0.25, t2 + i * 0.2 + 0.02);
                    g2.gain.exponentialRampToValueAtTime(0.0001, t2 + i * 0.2 + 0.18);
                });
                o2.start();
                o2.stop(t2 + seq.length * 0.2 + 0.1);
            } catch (e) {}
            previewIntervalId = null;
        }, 1500);
    } catch (e) {
        console.warn('试听失败:', e);
    }
}

// 试听自定义铃声（播放约3秒，不循环）
async function playPreviewCustomTone(customData) {
    stopPreviewTone();
    
    if (!ringingAlarmSharedCtx) initSharedAudioContext();
    const ctx = ringingAlarmSharedCtx;
    if (!ctx) return;
    
    if (ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) {}
    }
    
    // 如果是相同的数据且已有buffer，直接播放
    let buffer = null;
    if (previewToneDataKey === customData && previewBuffer) {
        buffer = previewBuffer;
    } else {
        // 解码音频
        try {
            const arrayBuffer = dataUrlToArrayBuffer(customData);
            buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            previewBuffer = buffer;
            previewToneDataKey = customData;
        } catch (e) {
            console.warn('试听解码失败:', e);
            // 失败回退到经典铃声
            playPreviewBuiltinTone('classic');
            return;
        }
    }
    
    if (!buffer) return;
    
    // 播放（只播放一次，不循环）
    try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        previewSource = source;
        
        // 3秒后自动停止
        setTimeout(() => {
            if (previewSource === source) {
                try { source.stop(); } catch (e) {}
                previewSource = null;
            }
        }, 3000);
    } catch (e) {
        console.warn('试听播放失败:', e);
    }
}

// 播放铃声试听（根据tone类型选择）
function playPreviewTone(toneId) {
    // 检查是否是自定义铃声
    const ringtone = getCustomRingtoneById(toneId);
    if (ringtone && ringtone.data) {
        playPreviewCustomTone(ringtone.data);
    } else {
        // 内置铃声
        playPreviewBuiltinTone(toneId);
    }
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

    // 切换到记忆页面时自动渲染
    if (pageId === 'memory') {
        setTimeout(renderMemoryList, 50);
    }

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
    toneId: 'classic',
    repeat: 'daily',
    vibrate: false,
    customDays: [],
    customToneName: '',
    customToneData: '',
    pendingAddedRingtoneIds: []   // 本次打开模态框期间新上传的铃声ID（取消/改选时自动清理）
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
            modalState.toneId = alarm.toneId || 'classic';
            modalState.repeat = alarm.repeat || 'daily';
            modalState.vibrate = !!alarm.vibrate;
            modalState.customDays = (alarm.customDays || []).slice();
            modalState.customToneName = alarm.customToneName || '';
            modalState.customToneData = alarm.customToneData || '';
            modalState.pendingAddedRingtoneIds = [];
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
        modalState.toneId = 'classic';
        modalState.repeat = 'daily';
        modalState.vibrate = false;
        modalState.customDays = [];
        modalState.customToneName = '';
        modalState.customToneData = '';
        modalState.pendingAddedRingtoneIds = [];
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

    // 停止铃声试听
    stopPreviewTone();

    // 清理「本次新上传但最终未被选中的铃声」（避免铃声残留在铃声库里越积越多）
    const pending = modalState.pendingAddedRingtoneIds || [];
    if (pending.length) {
        const data = loadData();
        const finalToneId = modalState.toneId;
        let changed = false;
        for (const rid of pending) {
            if (rid === finalToneId) continue; // 本次选中的铃声保留
            data.customRingtones = (data.customRingtones || []).filter(r => r.id !== rid);
            changed = true;
        }
        if (changed) saveData(data);
        modalState.pendingAddedRingtoneIds = [];
    }

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

    // 铃声点击（选中铃声并试听播放）
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
        
        // 播放试听
        playPreviewTone(tone);
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

            // 记录本次上传到待确认列表，若最终未选中/用户取消则自动清理
            if (!modalState.pendingAddedRingtoneIds.includes(ringtone.id)) {
                modalState.pendingAddedRingtoneIds.push(ringtone.id);
            }

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

    // 记忆浏览页标题手动输入
    initMemoryBrowseTitleInput();

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
    
    // 第一行：日期数字 + 休标签（同一行，居中）
    html += `<div class="day-first-row">`;
    html += `<span class="day-date" style="${dateColor}">${date.getDate()}</span>`;
    if (isHol && !isOtherMonth) {
        html += '<span class="day-rest-tag">休</span>';
    }
    html += `</div>`;
    
    // 第二行：农历（居中，同一行）
    if (!isOtherMonth) {
        html += `<div class="day-lunar-row">`;
        html += `<span class="day-lunar">${lunar}</span>`;
        html += `</div>`;
        
        // 第三行：节日名称（居中同一行，若有）
        if (holiday) {
            html += `<div class="day-holiday-row">`;
            html += `<span class="day-holiday-tag">${holiday}</span>`;
            html += `</div>`;
        }
    }
    
    html += '</div>';
    
    return html;
}

// 转义HTML字符
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    
    const isToday = dateStr === todayStr;
    titleEl.textContent = isToday ? '今日作息' : `${date.getMonth() + 1}月${date.getDate()}日作息`;
    
    // 读取并显示当日的激励语
    const motivationEl = document.getElementById('dayMotivationContent');
    const savedMotivation = getDayMotivation(dateStr);
    if (savedMotivation) {
        motivationEl.textContent = savedMotivation;
    } else {
        motivationEl.textContent = '点击上方"手动输入"或"AI填写"添加激励语';
    }
    
    renderScheduleList();
    window.scrollTo(0, 0);
}

// ========== 每日激励语功能 ==========

// 读取某天的激励语
function getDayMotivation(dateStr) {
    return localStorage.getItem(`day_motivation_${dateStr}`) || '';
}

// 保存某天的激励语
function saveDayMotivation(dateStr, value) {
    if (value && value.trim()) {
        localStorage.setItem(`day_motivation_${dateStr}`, value.trim());
    } else {
        localStorage.removeItem(`day_motivation_${dateStr}`);
    }
}

// 显示手动输入弹窗
function showManualMotivationInput() {
    const modal = document.getElementById('manualMotivationModal');
    const textarea = document.getElementById('manualMotivationInput');
    
    // 预填充已保存的内容
    const saved = getDayMotivation(currentScheduleDate);
    textarea.value = saved || '';
    
    modal.classList.add('show');
    textarea.focus();
}

// 保存手动输入的激励语
function saveManualMotivation() {
    const textarea = document.getElementById('manualMotivationInput');
    const value = textarea.value.trim();
    
    saveDayMotivation(currentScheduleDate, value);
    
    // 更新显示
    const motivationEl = document.getElementById('dayMotivationContent');
    motivationEl.textContent = value || '点击上方"手动输入"或"AI填写"添加激励语';
    
    closeMotivationModal('manualMotivationModal');
}

// 显示AI填写弹窗
function showAIMotivationInput() {
    const modal = document.getElementById('AIMotivationModal');
    const textarea = document.getElementById('AIMotivationKeyword');
    
    // 清空关键词输入
    textarea.value = '';
    
    modal.classList.add('show');
    textarea.focus();
}

// AI生成激励语 - 本地模板生成
function generateAIMotivation() {
    const textarea = document.getElementById('AIMotivationKeyword');
    let keywords = textarea.value.trim();
    
    // 默认关键词
    if (!keywords) {
        keywords = '坚持 努力 成长';
    }
    
    // 解析关键词（支持空格、逗号、顿号分隔）
    const keywordArray = keywords.split(/[\s,，、]+/).filter(k => k.length > 0);
    
    // 根据关键词生成激励语
    const motivation = generateMotivationFromKeywords(keywordArray);
    
    // 保存并显示
    saveDayMotivation(currentScheduleDate, motivation);
    const motivationEl = document.getElementById('dayMotivationContent');
    motivationEl.textContent = motivation;
    
    closeMotivationModal('AIMotivationModal');
}

// 从关键词生成激励语
function generateMotivationFromKeywords(keywords) {
    // 激励语模板库
    const templates = {
        '工作': [
            '今日的每一份认真，都是明日成功的基石。',
            '专注当下，用心做事，时间会给出最好的答案。',
            '工作不仅是责任，更是成长的养分。',
            '把每一件小事做好，就是对自己最好的交代。',
            '用心对待每一份任务，收获每一次进步。'
        ],
        '学习': [
            '知识没有边界，成长没有终点。',
            '今日所学，明日所用，终身学习。',
            '学如逆水行舟，不进则退，保持好奇心。',
            '每一次思考都是进步的开始。',
            '学习是对自己最好的投资，永不过期。'
        ],
        '健康': [
            '健康是一切的基础，照顾好自己是最重要的事。',
            '早睡早起，精神百倍，健康生活每一天。',
            '身体是革命的本钱，爱护自己，从今天开始。',
            '运动让身体强壮，休息让心灵恢复。',
            '健康生活，规律作息，是对自己最好的爱。'
        ],
        '坚持': [
            '坚持的意义不在于结果，而在于过程中的每一步。',
            '今天再坚持一下，明天就会感谢自己。',
            '坚持是一种习惯，习惯决定命运。',
            '不轻易放弃，就会看到希望的曙光。',
            '每一次坚持，都是对梦想的靠近。'
        ],
        '努力': [
            '努力不一定成功，但不努力一定不会进步。',
            '今日的汗水，是明日的荣耀。',
            '努力的人，运气不会太差。',
            '脚踏实地，一步一步，终将抵达。',
            '努力是一种态度，也是一种能力。'
        ],
        '成长': [
            '每一次突破，都是成长的证明。',
            '成长就是不断超越过去的自己。',
            '保持学习的心态，每天都有新收获。',
            '成长是一场马拉松，不是百米冲刺。',
            '敢于挑战自己，才能遇见更好的自己。'
        ],
        '生活': [
            '热爱生活的人，生活也会热爱他。',
            '生活不需要完美，只需要真实。',
            '在平凡的日子里，寻找不平凡的意义。',
            '用心感受每一刻，生活处处是美好。',
            '简单生活，简单快乐，简单幸福。'
        ],
        '感恩': [
            '感恩每一天，感恩身边的每一个人。',
            '心怀感恩，遇见更多美好。',
            '感恩让心灵更柔软，让生活更温暖。',
            '每一份拥有都是恩赐，每一次相遇都是缘分。',
            '以感恩之心，迎接每一天的阳光。'
        ],
        '梦想': [
            '有梦想谁都了不起，勇敢去追。',
            '梦想的路上不拥挤，坚持的人不多。',
            '今日的梦想，是明日的现实。',
            '不为失败找借口，只为成功找方法。',
            '保持梦想，保持热爱，奔赴山海。'
        ],
        '时间': [
            '时间不会辜负每一个认真的人。',
            '珍惜当下，把握每一分每一秒。',
            '时间是最公平的，每个人都有24小时。',
            '把时间用在有意义的事情上。',
            '今日的时间，塑造明日的自己。'
        ],
        '心态': [
            '心态决定状态，状态决定未来。',
            '积极的心态，是最好的护身符。',
            '放宽心，慢慢来，一切都会好起来。',
            '心若向阳，无畏悲伤。',
            '保持乐观，生活处处是阳光。'
        ]
    };
    
    // 通用模板（当没有匹配的关键词时使用）
    const generalTemplates = [
        '今日事今日毕，明日事今日谋。',
        '用积极的心态，迎接美好的一天。',
        '每一步都是进步，每一天都是开始。',
        '用心做事，真诚待人，定会收获。',
        '相信自己，你比想象中更强大。',
        '今日的努力，是明日的底气。',
        '保持热爱，奔赴山海，未来可期。',
        '一天一点进步，一月一点成长。',
        '认真的人改变自己，坚持的人改变命运。',
        '把平凡的事情做好，就是不平凡。'
    ];
    
    // 收集匹配的模板
    let selectedSentences = [];
    
    for (const keyword of keywords) {
        // 精确匹配
        if (templates[keyword]) {
            const pool = templates[keyword];
            const randomIndex = Math.floor(Math.random() * pool.length);
            selectedSentences.push(pool[randomIndex]);
        } else {
            // 模糊匹配 - 检查其他关键词是否包含
            let found = false;
            for (const key in templates) {
                if (key.includes(keyword) || keyword.includes(key)) {
                    const pool = templates[key];
                    const randomIndex = Math.floor(Math.random() * pool.length);
                    selectedSentences.push(pool[randomIndex]);
                    found = true;
                    break;
                }
            }
            // 未匹配则用通用模板
            if (!found) {
                const randomIndex = Math.floor(Math.random() * generalTemplates.length);
                selectedSentences.push(generalTemplates[randomIndex]);
            }
        }
    }
    
    // 如果没有关键词或选择了太多，截取2-3句
    let result;
    if (selectedSentences.length === 0) {
        const randomIndex = Math.floor(Math.random() * generalTemplates.length);
        result = generalTemplates[randomIndex];
    } else if (selectedSentences.length === 1) {
        result = selectedSentences[0];
    } else {
        // 截取2-3句组成一段话
        const count = Math.min(selectedSentences.length, 3);
        result = selectedSentences.slice(0, count).join('\n');
    }
    
    return result;
}

// 关闭激励语弹窗
function closeMotivationModal(modalId, event) {
    // 如果提供了事件且点击的不是弹内容（即点击了背景），才关闭
    if (event && event.target && !event.target.classList.contains('motivation-modal')) {
        return;
    }
    
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

// 点击弹窗背景关闭
document.addEventListener('DOMContentLoaded', function() {
    const motivationModals = document.querySelectorAll('.motivation-modal');
    motivationModals.forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    });
});

// 自动调整 textarea 高度
function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';
}

// 读取某天详情的备注
function getDayDetailNote(dateStr, field) {
    return localStorage.getItem(`day_detail_${dateStr}_${field}`) || '';
}

// 保存某天详情的备注
function saveDayDetailNote(dateStr, field, value) {
    if (value && value.trim()) {
        localStorage.setItem(`day_detail_${dateStr}_${field}`, value);
    } else {
        localStorage.removeItem(`day_detail_${dateStr}_${field}`);
    }
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

/* ============ AI通话功能 ============ */
let isCallActive = false;
let callDuration = 0;
let callInterval = null;

function toggleAICall() {
    if (isCallActive) {
        endAICall();
    } else {
        startAICall();
    }
}

function startAICall() {
    isCallActive = true;
    callDuration = 0;

    const statusEl = document.getElementById('aiCallStatus');
    if (statusEl) statusEl.textContent = '通话中...';

    const avatar = document.getElementById('aiCallAvatar');
    if (avatar) {
        avatar.style.boxShadow = '0 0 30px rgba(255, 107, 107, 0.6)';
    }

    callInterval = setInterval(() => {
        callDuration++;
        const mins = Math.floor(callDuration / 60).toString().padStart(2, '0');
        const secs = (callDuration % 60).toString().padStart(2, '0');
        const durationEl = document.getElementById('aiCallDuration');
        if (durationEl) durationEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

function endAICall() {
    isCallActive = false;
    if (callInterval) {
        clearInterval(callInterval);
        callInterval = null;
    }

    const statusEl = document.getElementById('aiCallStatus');
    if (statusEl) statusEl.textContent = '点击下方按钮开始通话';

    const durationEl = document.getElementById('aiCallDuration');
    if (durationEl) durationEl.textContent = '00:00';

    const avatar = document.getElementById('aiCallAvatar');
    if (avatar) {
        avatar.style.boxShadow = '0 8px 24px rgba(255, 107, 107, 0.3)';
    }
}

function toggleAIMic() {
    alert('麦克风功能：您可以说话，AI正在聆听（演示）');
}

function toggleAISpeaker() {
    alert('免提功能：切换扬声器/听筒（演示）');
}

function showAIHistory() {
    const history = document.getElementById('aiCallHistory');
    if (history) {
        if (history.style.display === 'none') {
            history.style.display = 'block';
        } else {
            history.style.display = 'none';
        }
    }
}

function startAICallWith(topic) {
    if (!isCallActive) {
        startAICall();
    }
    const history = document.getElementById('aiCallHistory');
    if (history) history.style.display = 'block';
    const listEl = document.getElementById('aiCallHistoryList');
    if (listEl) {
        const newMsg = document.createElement('div');
        newMsg.className = 'ai-call-history-item ai-user';
        newMsg.innerHTML = `<span class="history-role">您</span><p>${topic}</p>`;
        listEl.appendChild(newMsg);

        const aiResp = document.createElement('div');
        aiResp.className = 'ai-call-history-item ai-ai';
        aiResp.innerHTML = `<span class="history-role">AI助手</span><p>好的，我来帮您处理关于${topic}的内容。请问您具体需要什么帮助？</p>`;
        listEl.appendChild(aiResp);

        // 自动滚动到底部，让新消息可见
        history.scrollTop = history.scrollHeight;
    }
}

/* ============ 模式切换功能 ============ */
const modeInfo = {
    work: { name: '💼 工作模式', desc: '专注工作，减少干扰，优化效率', focus: '09:00 - 18:00', interval: '每50分钟', notify: '重要通知' },
    study: { name: '📖 学习模式', desc: '沉浸学习，知识积累，提升自我', focus: '全天', interval: '每45分钟', notify: '重要通知' },
    exercise: { name: '💪 运动模式', desc: '活力锻炼，健康生活，增强体质', focus: '17:00 - 20:00', interval: '每60分钟', notify: '运动提醒' },
    rest: { name: '😴 休息模式', desc: '放松身心，恢复精力，平和安宁', focus: '22:00 - 08:00', interval: '每2小时', notify: '勿打扰' }
};

let currentMode = 'work';

function switchMode(mode) {
    currentMode = mode;
    const info = modeInfo[mode];

    const nameEl = document.getElementById('currentModeName');
    const descEl = document.getElementById('currentModeDesc');
    const focusEl = document.getElementById('modeFocusTime');
    const intervalEl = document.getElementById('modeRestInterval');
    const notifyEl = document.getElementById('modeNotifyLevel');
    const usedEl = document.getElementById('modeUsedTime');

    if (nameEl) nameEl.textContent = info.name;
    if (descEl) descEl.textContent = info.desc;
    if (focusEl) focusEl.textContent = info.focus;
    if (intervalEl) intervalEl.textContent = info.interval;
    if (notifyEl) notifyEl.textContent = info.notify;
    if (usedEl) usedEl.textContent = '已切换';
}

/* ============ 记忆管理功能 ============ */
const MEMORY_KEY = 'zhilv_memory_data';
const FOLDER_LIST_KEY = 'zhilv_memory_folders';
// 文件夹颜色池（新增文件夹时循环使用）
const FOLDER_COLOR_POOL = ['#7c8cff', '#c97cff', '#ffb86b', '#ff6b6b', '#4ecdc4', '#a8e6cf', '#ff8f7a', '#b59cff'];
// 归为"文件夹"的分类（其他分类视为"未分类"）——支持用户动态增删改
let FOLDER_CATEGORIES = [];
let memoryData = [];
let currentMemoryCategory = 'all';   // 'all' | 'folder' | 'uncategorized'
let editingMemoryId = null;
let selectedCategory = '学习笔记';
let currentViewingMemoryId = null;   // 当前查看的记忆ID
// 当前正在编辑名称的文件夹（null 表示没有）
let editingFolderName = null;

// ===== 文件夹数据加载/保存 =====
// 默认文件夹配置
const DEFAULT_FOLDERS = [
    { name: '学习笔记', color: '#7c8cff' },
    { name: '生活感悟', color: '#c97cff' },
    { name: '工作总结', color: '#ffb86b' },
    { name: '灵感创意', color: '#ff6b6b' }
];

// 动态获取文件夹列表（名称 + 颜色）
function getFolderList() {
    const saved = localStorage.getItem(FOLDER_LIST_KEY);
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return JSON.parse(JSON.stringify(DEFAULT_FOLDERS));
        }
    }
    return JSON.parse(JSON.stringify(DEFAULT_FOLDERS));
}

// 保存文件夹列表
function saveFolderList(folders) {
    localStorage.setItem(FOLDER_LIST_KEY, JSON.stringify(folders));
    // 同时更新 FOLDER_CATEGORIES（仅名称）
    FOLDER_CATEGORIES = folders.map(f => f.name);
}

// 同步 FOLDER_CATEGORIES（从持久化数据读取文件夹名称集合）
function syncFolderCategories() {
    const folders = getFolderList();
    FOLDER_CATEGORIES = folders.map(f => f.name);
    if (FOLDER_CATEGORIES.length > 0 && !FOLDER_CATEGORIES.includes(selectedCategory)) {
        selectedCategory = FOLDER_CATEGORIES[0];
    }
}

// 打开新建文件夹模态框
function addNewFolder() {
    const modal = document.getElementById('memoryFolderModal');
    if (modal) {
        modal.style.display = 'flex';
        // 清空输入框并聚焦
        const input = document.getElementById('folderModalNameInput');
        if (input) {
            input.value = '';
            input.focus();
        }
        // 重置自定义图案选择状态
        currentSelectedIcon = null;
        // 重置预览图标为默认状态
        const previewEmojiEl = document.getElementById('folderModalPreviewEmoji');
        if (previewEmojiEl) previewEmojiEl.textContent = '📁';
    }
}

// 关闭新建文件夹模态框
function closeFolderModal() {
    const modal = document.getElementById('memoryFolderModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 自定义图案选择模态框逻辑
let currentSelectedIcon = null;  // 当前选中的图标

// 可选的自定义图案列表（emoji + 简易符号）
const FOLDER_ICON_LIST = [
    // 符号类
    '⭐', '🌟', '✨', '💫', '🔮', '🎯', '🏆', '🥇', '🎖️',
    // 情感类
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💕', '💖',
    // 面部表情
    '😊', '🤗', '😎', '🤔', '😴', '🥰', '😍', '🤩', '😇', '🤓',
    // 手势类
    '👍', '👎', '👌', '✌️', '🤝', '👏', '🙌', '👋', '🤚', '✋',
    // 工具类
    '💡', '📌', '🔍', '🔧', '⚙️', '🛠️', '🔑', '🗝️', '📎', '📋',
    // 学习工作
    '📚', '📖', '📝', '📄', '📑', '📒', '📓', '📕', '📗', '📘',
    // 科技数码
    '💻', '📱', '🖥️', '💾', '💿', '📺', '📷', '📹', '🎮', '🎧',
    // 生活用品
    '🎒', '👜', '👝', '🎁', '💝', '🎀', '🧸', '🪄', '🎈', '🎪',
    // 食品类
    '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🥝', '🍍', '🍌',
    '🍰', '🍩', '🍪', '🎂', '🧁', '🍫', '🍬', '🍭', '☕', '🍵',
    // 植物自然
    '🌸', '🌺', '🌷', '🌹', '🌻', '🌼', '🍀', '🌿', '🍄', '🌵',
    '🌴', '🌲', '🌳', '🍁', '🍂', '🌾', '🌱', '🌵', '🌺', '🌷',
    // 动物类
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
    '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦋',
    // 天气自然
    '☀️', '🌤️', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌪️', '🌈',
    // 旅行地点
    '🏠', '🏡', '🏢', '🏫', '🏥', '🏪', '🏬', '🏭', '🌋', '🗻',
    '✈️', '🚗', '🚕', '🚙', '🚌', '🚚', '🚢', '🚁', '🚀', '🛸',
    // 运动类
    '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸',
    // 音乐娱乐
    '🎵', '🎶', '🎤', '🎧', '🎹', '🥁', '🎷', '🎺', '🎬', '🎭',
    // 几何图形
    '🔵', '🔴', '🟡', '🟢', '🟣', '🟠', '⚪', '⚫', '🔶', '🔷',
];

// 根据名称智能匹配 emoji 图标（网上取材的智能匹配逻辑）
function getSmartEmoji(name) {
    if (!name) return '📁';
    const lowerName = name.toLowerCase();
    
    // 根据关键词匹配对应图标
    const emojiMap = [
        // 学习类
        { keywords: ['学习', '笔记', '读书', '书', '知识', '课程', '作业', '考试', '复习', '考研', '高考', '学校', '课堂'], emoji: '📚' },
        { keywords: ['代码', '编程', '开发', '程序', '项目', 'git', 'github', 'api', '前端', '后端', 'python', 'java', 'js', 'vue', 'react'], emoji: '💻' },
        { keywords: ['英语', '外语', '语言', '单词', '翻译'], emoji: '🌍' },
        { keywords: ['数学', '公式', '计算', '算法'], emoji: '🧮' },
        
        // 工作类
        { keywords: ['工作', '办公', '会议', '报告', '项目', '任务', '计划', '总结', '周报', '日报'], emoji: '💼' },
        { keywords: ['设计', '创意', '美工', 'ui', 'ux', '视觉'], emoji: '🎨' },
        { keywords: ['数据', '分析', '报表', '图表', '统计'], emoji: '📊' },
        { keywords: ['管理', '团队', '领导', '组织'], emoji: '👥' },
        
        // 生活类
        { keywords: ['生活', '日常', '日记', '随笔', '心情', '感悟', '心得', '想法'], emoji: '💭' },
        { keywords: ['旅行', '旅游', '出行', '游记', '风景'], emoji: '✈️' },
        { keywords: ['美食', '菜谱', '烹饪', '吃饭', '餐厅'], emoji: '🍳' },
        { keywords: ['健康', '运动', '健身', '跑步', '瑜伽', '减肥'], emoji: '💪' },
        { keywords: ['照片', '相册', '影像', '摄影'], emoji: '📷' },
        { keywords: ['音乐', '歌曲', '歌单', '音频'], emoji: '🎵' },
        { keywords: ['电影', '视频', '追剧', '影视'], emoji: '🎬' },
        
        // 创意类
        { keywords: ['灵感', '创意', '脑洞', '点子', '想法', '创意'], emoji: '✨' },
        { keywords: ['写作', '文章', '博客', '文案', '故事'], emoji: '✍️' },
        { keywords: ['画画', '绘画', '插画', '手绘'], emoji: '🖌️' },
        
        // 财务类
        { keywords: ['财务', '记账', '预算', '支出', '收入', '理财', '投资'], emoji: '💰' },
        
        // 其他
        { keywords: ['收藏', '喜欢', '归档', '备份'], emoji: '⭐' },
        { keywords: ['计划', '目标', '愿望', '清单'], emoji: '📋' },
        { keywords: ['密码', '账号', '安全'], emoji: '🔐' },
        { keywords: ['待办', 'todo', '任务'], emoji: '✅' },
    ];
    
    // 优先匹配关键词
    for (const item of emojiMap) {
        if (item.keywords.some(kw => lowerName.includes(kw))) {
            return item.emoji;
        }
    }
    
    // 如果名称包含数字或特殊字符，返回科技感图标
    if (/[0-9]/.test(name)) return '📱';
    if (/[\-_@#$%^&*]/.test(name)) return '🔧';
    
    // 默认返回文件夹图标
    return '📁';
}

// 根据名称智能匹配颜色（与 emoji 风格协调）
function getSmartColor(name) {
    if (!name) return '#7c8cff';
    const lowerName = name.toLowerCase();
    
    // 颜色映射（与 emoji 风格对应）
    const colorMap = [
        { keywords: ['学习', '笔记', '读书', '知识', '代码', '编程', '开发'], color: '#7c8cff' },   // 科技蓝
        { keywords: ['工作', '办公', '会议', '管理', '团队'], color: '#ffb86b' },                     // 暖橙
        { keywords: ['生活', '日常', '心情', '感悟'], color: '#c97cff' },                             // 优雅紫
        { keywords: ['旅行', '风景', '自然'], color: '#4ecdc4' },                                      // 清新绿
        { keywords: ['美食', '健康', '运动'], color: '#ff8f7a' },                                      // 活力橙红
        { keywords: ['创意', '灵感', '写作', '画画'], color: '#a8e6cf' },                              // 薄荷绿
        { keywords: ['财务', '记账', '理财'], color: '#ffd93d' },                                      // 金色
        { keywords: ['音乐', '电影', '照片'], color: '#6c5ce7' },                                      // 深紫
    ];
    
    for (const item of colorMap) {
        if (item.keywords.some(kw => lowerName.includes(kw))) {
            return item.color;
        }
    }
    
    // 如果没有匹配，从颜色池中选择（基于名称长度取模）
    return FOLDER_COLOR_POOL[name.length % FOLDER_COLOR_POOL.length];
}

// 更新模态框中的图标预览（优先使用用户手动选择的图案，否则智能匹配）
function updateFolderPreview() {
    const input = document.getElementById('folderModalNameInput');
    const iconEl = document.getElementById('folderModalPreviewIcon');
    if (!input || !iconEl) return;
    
    const name = input.value.trim();
    // 优先使用用户手动选择的图案
    const emoji = currentSelectedIcon || getSmartEmoji(name);
    const color = getSmartColor(name);
    
    // 更新图标颜色
    iconEl.style.setProperty('--folder-color', color);
    
    // 更新 emoji
    const emojiEl = document.getElementById('folderModalPreviewEmoji');
    if (emojiEl) {
        emojiEl.textContent = emoji;
    }
}

// 设置快速标签名称
function setFolderName(name) {
    const input = document.getElementById('folderModalNameInput');
    if (input) {
        input.value = name;
        updateFolderPreview();
        input.focus();
    }
}

// ===== 自定义图案选择器 =====
let pendingSelectedIcon = null;  // 待确认的选中图案

// 打开图案选择模态框
function openIconPicker() {
    const modal = document.getElementById('memoryIconPicker');
    const gridEl = document.getElementById('memoryIconPickerGrid');
    if (!modal || !gridEl) return;
    
    // 初始化待确认值为当前预览值（若无则用默认）
    const previewEmojiEl = document.getElementById('folderModalPreviewEmoji');
    pendingSelectedIcon = previewEmojiEl ? previewEmojiEl.textContent : '📁';
    
    // 渲染图标网格
    renderIconPickerGrid();
    
    modal.style.display = 'flex';
}

// 关闭图案选择模态框
function closeIconPicker() {
    const modal = document.getElementById('memoryIconPicker');
    if (modal) {
        modal.style.display = 'none';
    }
}

// 渲染图标网格（每格可点击选中，选中的有绿色边框高亮）
function renderIconPickerGrid() {
    const gridEl = document.getElementById('memoryIconPickerGrid');
    if (!gridEl) return;
    
    // 去重后渲染（emoji 列表里可能有重复）
    const seen = new Set();
    const uniqueIcons = FOLDER_ICON_LIST.filter(emoji => {
        if (seen.has(emoji)) return false;
        seen.add(emoji);
        return true;
    });
    
    let html = '';
    uniqueIcons.forEach(emoji => {
        const isSelected = emoji === pendingSelectedIcon;
        html += `
            <div class="memory-icon-picker-item${isSelected ? ' is-selected' : ''}"
                 onclick="selectPickerIcon('${emoji}')">
                <span class="memory-icon-picker-emoji">${emoji}</span>
            </div>
        `;
    });
    gridEl.innerHTML = html;
}

// 选中某个图案（点击切换选中态，无默认选中逻辑由 pendingSelectedIcon 控制）
function selectPickerIcon(emoji) {
    pendingSelectedIcon = emoji;
    // 重新渲染以更新高亮状态
    renderIconPickerGrid();
}

// 确认选择的图案 → 应用到预览区
function confirmIconPicker() {
    if (pendingSelectedIcon) {
        currentSelectedIcon = pendingSelectedIcon;
        // 同步更新预览
        const previewEmojiEl = document.getElementById('folderModalPreviewEmoji');
        if (previewEmojiEl) {
            previewEmojiEl.textContent = currentSelectedIcon;
        }
    }
    closeIconPicker();
}

// 确认创建文件夹（使用用户选择的图案）
function confirmCreateFolder() {
    const input = document.getElementById('folderModalNameInput');
    if (!input) return;
    
    const trimmedName = input.value.trim();
    if (!trimmedName) {
        alert('请输入文件夹名称');
        input.focus();
        return;
    }
    
    const folders = getFolderList();
    if (folders.some(f => f.name === trimmedName)) {
        alert('该文件夹已存在');
        input.focus();
        return;
    }
    
    // 使用用户选择的图案；否则智能匹配
    const emoji = currentSelectedIcon || getSmartEmoji(trimmedName);
    const color = getSmartColor(trimmedName);
    
    folders.push({ name: trimmedName, color: color, emoji: emoji });
    saveFolderList(folders);
    
    // 重置选中状态，关闭模态框并刷新页面
    currentSelectedIcon = null;
    closeFolderModal();
    renderMemoryBrowseResults();
    refreshMemoryStats();
}

// ===== 删除确认模态框逻辑 =====
let confirmCallback = null;  // 确认后的回调函数
let confirmData = null;      // 传递给回调的数据

// 打开删除确认模态框（二选一模式：点击选中，无默认选中）
function openConfirmModal(message, callback, data) {
    confirmCallback = callback;
    confirmData = data;
    
    const modal = document.getElementById('memoryConfirmModal');
    const msgEl = document.getElementById('confirmModalMessage');
    const cancelBtn = document.querySelector('.memory-confirm-modal-btn-cancel');
    const deleteBtn = document.querySelector('.memory-confirm-modal-btn-delete');
    
    if (msgEl) msgEl.textContent = message;
    // 清除选中状态（无默认选中）
    if (cancelBtn) cancelBtn.classList.remove('selected');
    if (deleteBtn) deleteBtn.classList.remove('selected');
    
    if (modal) modal.style.display = 'flex';
}

// 关闭确认模态框
function closeConfirmModal(isDelete) {
    const modal = document.getElementById('memoryConfirmModal');
    const cancelBtn = document.querySelector('.memory-confirm-modal-btn-cancel');
    const deleteBtn = document.querySelector('.memory-confirm-modal-btn-delete');
    
    if (modal) modal.style.display = 'none';
    // 清除选中状态
    if (cancelBtn) cancelBtn.classList.remove('selected');
    if (deleteBtn) deleteBtn.classList.remove('selected');
    
    // 执行回调（如果有）
    if (confirmCallback) {
        confirmCallback(isDelete, confirmData);
        confirmCallback = null;
        confirmData = null;
    }
}

// 选择确认选项（点击选中高亮）
function selectConfirmOption(isDelete) {
    const cancelBtn = document.querySelector('.memory-confirm-modal-btn-cancel');
    const deleteBtn = document.querySelector('.memory-confirm-modal-btn-delete');
    
    // 清除两边选中状态
    if (cancelBtn) cancelBtn.classList.remove('selected');
    if (deleteBtn) deleteBtn.classList.remove('selected');
    
    // 高亮当前选中的按钮
    if (isDelete) {
        if (deleteBtn) deleteBtn.classList.add('selected');
    } else {
        if (cancelBtn) cancelBtn.classList.add('selected');
    }
    
    // 点击后立即执行并关闭（选中即确认）
    closeConfirmModal(isDelete);
}

// 删除文件夹（使用自定义确认模态框）
function deleteFolder(folderName, event) {
    if (event) event.stopPropagation();
    const folders = getFolderList();
    const idx = folders.findIndex(f => f.name === folderName);
    if (idx < 0) return;
    const count = memoryData.filter(item => item.category === folderName).length;
    const message = count > 0
        ? `删除文件夹"${folderName}"？其中的 ${count} 条记忆将变为"未分类"。`
        : `确认删除文件夹"${folderName}"？`;
    
    // 使用自定义确认模态框
    openConfirmModal(message, (isDelete) => {
        if (!isDelete) return;  // 取消
        
        // 将该文件夹内的记忆变为未分类
        memoryData.forEach(item => {
            if (item.category === folderName) item.category = '';
        });
        saveMemoryData();
        folders.splice(idx, 1);
        saveFolderList(folders);
        // 同步刷新浏览页和记忆主页顶部计数
        renderMemoryBrowseResults();
        refreshMemoryStats();
    }, folderName);
}

// 编辑文件夹名称（双击进入编辑态，回车保存，Esc 取消）
function startEditFolderName(folderName, event) {
    if (event) event.stopPropagation();
    editingFolderName = folderName;
    renderMemoryBrowseResults();
    // 现在 renderMemoryBrowseResults 内部已在其内部的 setTimeout 中做聚焦逻辑里自动处理——这里不需要额外再一次确保聚焦
    setTimeout(() => {
        const input = document.querySelector('.js-folder-name-input');
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function saveEditFolderName(newName) {
    if (!editingFolderName) return;
    const trimmed = (newName || '').trim();
    if (!trimmed) {
        editingFolderName = null;
        renderMemoryBrowseResults();
        return;
    }
    const folders = getFolderList();
    const idx = folders.findIndex(f => f.name === editingFolderName);
    if (idx < 0) {
        editingFolderName = null;
        renderMemoryBrowseResults();
        return;
    }
    if (folders.some(f => f.name === trimmed && f.name !== editingFolderName)) {
        alert('该文件夹名称已存在');
        return;
    }
    const oldName = editingFolderName;
    folders[idx].name = trimmed;
    saveFolderList(folders);
    // 迁移记忆数据
    memoryData.forEach(item => {
        if (item.category === oldName) item.category = trimmed;
    });
    saveMemoryData();
    editingFolderName = null;
    // 刷新浏览页 + 记忆主页顶部计数
    renderMemoryBrowseResults();
    refreshMemoryStats();
}

function cancelEditFolderName() {
    editingFolderName = null;
    renderMemoryBrowseResults();
}

// ===== 记忆数据加载/保存 =====
function loadMemoryData() {
    syncFolderCategories();
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved) {
        try {
            memoryData = JSON.parse(saved);
        } catch (e) {
            memoryData = [];
        }
    } else {
        // 默认示例数据
        memoryData = [
            { id: 1, title: '编程学习要点', content: '记录前端开发核心知识点，包括HTML、CSS、JavaScript 等基础内容。', category: '学习笔记', createdAt: Date.now() - 25200000 },
            { id: 2, title: '周末爬山心得', content: '今天去爬山，大自然让人心旷神怡，运动后状态更好。要坚持每周一次户外活动。', category: '生活感悟', createdAt: Date.now() - 50400000 },
            { id: 3, title: '本周重点任务', content: '完成项目A的需求评审，准备项目B的方案设计，同时跟进测试进度。', category: '工作总结', createdAt: Date.now() - 75600000 },
            { id: 4, title: '读书笔记：活法', content: '人生的意义在于磨练灵魂，在努力工作中找到生命的价值。', category: '学习笔记', createdAt: Date.now() - 100800000 },
            { id: 5, title: '健身计划', content: '每周跑步3次，每次30分钟，加上核心肌群训练，保持健康状态。', category: '生活感悟', createdAt: Date.now() - 126000000 },
            { id: 6, title: '会议记录：产品规划会', content: 'Q3重点功能包括用户中心升级、消息推送优化、数据看板增强。', category: '工作总结', createdAt: Date.now() - 151200000 },
            { id: 7, title: '学习英语单词', content: '每天背30个单词，坚持一个月后复习效果明显提升。', category: '学习笔记', createdAt: Date.now() - 176400000 },
            { id: 8, title: '周末美食探店', content: '新开的日料店寿司很好吃，环境也很棒，下次带朋友一起来。', category: '生活感悟', createdAt: Date.now() - 201600000 },
            { id: 9, title: '代码review要点', content: '注意命名规范、注释完整、逻辑清晰，同时关注性能和安全问题。', category: '工作总结', createdAt: Date.now() - 226800000 },
            { id: 10, title: '设计模式学习：单例', content: '单例模式保证一个类只有一个实例，常用于配置管理、日志记录等场景。', category: '学习笔记', createdAt: Date.now() - 252000000 },
            { id: 11, title: '今日心情：平静', content: '午后的阳光让人感到安静，工作效率也比平时高了不少。', category: '生活感悟', createdAt: Date.now() - 277200000 },
            { id: 12, title: '项目进度汇报', content: '本周完成用户模块开发，下周开始消息模块，预计两周内完成。', category: '工作总结', createdAt: Date.now() - 302400000 },
            { id: 13, title: '算法学习：二叉树', content: '二叉树遍历的前序、中序、后序方式，递归和迭代两种实现。', category: '学习笔记', createdAt: Date.now() - 327600000 },
            { id: 14, title: '灵感：产品新功能', content: '用户需要一个快速记录想法的功能，可以考虑加一个悬浮按钮。', category: '生活感悟', createdAt: Date.now() - 352800000 },
            { id: 15, title: '周会：团队协作', content: '本周讨论跨部门协作流程，优化沟通方式，减少不必要的会议。', category: '工作总结', createdAt: Date.now() - 378000000 },
            { id: 16, title: '学习笔记：React Hooks', content: 'useState用于状态管理，useEffect处理副作用，useContext跨层传递数据。', category: '学习笔记', createdAt: Date.now() - 403200000 },
            { id: 17, title: '电影观后感', content: '周末看了一部治愈系电影，很感动。生活就是要慢慢品味。', category: '生活感悟', createdAt: Date.now() - 428400000 },
            { id: 18, title: '产品需求梳理', content: '整理用户反馈的核心问题，排优先级后分配到下个迭代周期。', category: '工作总结', createdAt: Date.now() - 453600000 },
            { id: 19, title: '前端学习：性能优化', content: '图片懒加载、代码分割、缓存策略，三种方式共同提升页面加载速度。', category: '学习笔记', createdAt: Date.now() - 478800000 },
            { id: 20, title: '周末散步随想', content: '傍晚的公园很安静，思考了近期的生活和工作方向，感觉更清晰了。', category: '生活感悟', createdAt: Date.now() - 504000000 },
            { id: 21, title: '新功能上线检查', content: '检查发布后的用户反馈、监控数据、错误日志，确保系统稳定运行。', category: '工作总结', createdAt: Date.now() - 529200000 },
            { id: 22, title: '学习：CSS Grid布局', content: 'Grid是二维布局系统，可同时控制行和列，适合复杂页面结构。', category: '学习笔记', createdAt: Date.now() - 554400000 },
            { id: 23, title: '今日趣事', content: '午休时同事讲了一个很有意思的故事，笑得停不下来，下午心情一直很好。', category: '生活感悟', createdAt: Date.now() - 579600000 },
            { id: 24, title: '每日站会', content: '汇报昨日进度和今日计划，遇到的阻塞点需要和其他同事沟通。', category: '工作总结', createdAt: Date.now() - 604800000 },
            { id: 25, title: '学习JavaScript异步编程', content: 'Promise、async/await让异步代码更易读，配合事件循环机制理解更深。', category: '学习笔记', createdAt: Date.now() - 630000000 },
            { id: 26, title: '个人记账', content: '本月支出比上月多了一些，需要控制一下餐饮和购物的消费。', category: '生活感悟', createdAt: Date.now() - 655200000 },
            { id: 27, title: '需求评审：用户反馈', content: '收集用户对新版本的意见，整理成产品需求文档，和团队讨论可行性。', category: '工作总结', createdAt: Date.now() - 680400000 },
            { id: 28, title: '学习笔记：Vue3', content: '组合式API让代码组织更灵活，ref、reactive、computed是核心三剑客。', category: '学习笔记', createdAt: Date.now() - 705600000 },
            { id: 29, title: '周末咖啡馆', content: '去了一家新开的咖啡馆，环境不错，拿铁很好喝。享受了一个悠闲的下午。', category: '生活感悟', createdAt: Date.now() - 730800000 },
            { id: 30, title: '技术选型讨论', content: '讨论新项目的技术栈，权衡开发效率、团队熟悉度和长期维护成本。', category: '工作总结', createdAt: Date.now() - 756000000 },
            { id: 31, title: '学习：Git分支策略', content: 'Git Flow和Trunk Based Development各有优势，团队规模决定选择哪种。', category: '学习笔记', createdAt: Date.now() - 781200000 },
            { id: 32, title: '运动日记', content: '今天跑步5公里，配速7分钟，感觉不错。继续坚持每周三次有氧运动。', category: '生活感悟', createdAt: Date.now() - 806400000 },
            { id: 33, title: '项目里程碑', content: '项目达到一个重要里程碑，感谢团队的努力付出，下一阶段继续加油。', category: '工作总结', createdAt: Date.now() - 831600000 },
            { id: 34, title: '读书笔记：原则', content: '瑞·达利欧的《原则》让人思考如何系统化决策，把经验转化为可执行的原则。', category: '学习笔记', createdAt: Date.now() - 856800000 },
            { id: 35, title: '旅行计划', content: '计划下个月去海边度假，已经开始期待了。需要提前订好酒店和机票。', category: '生活感悟', createdAt: Date.now() - 882000000 },
            { id: 36, title: '复盘本月', content: '这个月完成了三个功能模块，学到了很多。下个月目标是提升代码质量。', category: '工作总结', createdAt: Date.now() - 907200000 },
            { id: 37, title: '学习：TypeScript', content: 'TypeScript的类型系统提供了更强的代码保护，接口、泛型让代码更健壮。', category: '学习笔记', createdAt: Date.now() - 932400000 }
        ];
        saveMemoryData();
    }
}

function saveMemoryData() {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(memoryData));
}

// 统一更新记忆主页顶部的分类计数（文件夹个数、记忆条数等）
// 把文件夹计数与 FOLDER_CATEGORIES / getFolderList() 强关联，确保与实际文件夹列表一致
function refreshMemoryStats() {
    // 先同步一次文件夹集合（避免初次加载时 FOLDER_CATEGORIES 仍为空）
    syncFolderCategories();
    const folders = getFolderList();

    const total = memoryData.length;
    // 「文件夹」按钮显示的是文件夹的个数（与文件夹浏览页一致）
    const folderCount = folders.length;
    // 「未分类」显示的是未归入任何文件夹的记忆条数 / 总记忆数
    const uncategorizedCount = memoryData.filter(item => !item.category || !FOLDER_CATEGORIES.includes(item.category)).length;

    const allNumEl = document.getElementById('filterAllNum');
    const folderNumEl = document.getElementById('filterFolderNum');
    const uncNumEl = document.getElementById('filterUncategorizedNum');
    const totalNumEl = document.getElementById('filterTotalNum');
    if (allNumEl) allNumEl.textContent = total;
    if (folderNumEl) folderNumEl.textContent = folderCount;
    if (uncNumEl) uncNumEl.textContent = uncategorizedCount;
    if (totalNumEl) totalNumEl.textContent = total;
}

function renderMemoryList() {
    // 四个圆环元素（东/南/西/北）
    const ringEast = document.getElementById('memoryRingEast');
    const ringNorth = document.getElementById('memoryRingNorth');
    const ringWest = document.getElementById('memoryRingWest');
    const ringSouth = document.getElementById('memoryRingSouth');
    const emptyEl = document.getElementById('memoryEmpty');

    // 刷新顶部计数（同时同步文件夹集合）
    refreshMemoryStats();

    // 1. 先按筛选类型过滤
    let filtered = memoryData;
    if (currentMemoryCategory === 'folder') {
        filtered = memoryData.filter(item => item.category && FOLDER_CATEGORIES.includes(item.category));
    } else if (currentMemoryCategory === 'uncategorized') {
        filtered = memoryData.filter(item => !item.category || !FOLDER_CATEGORIES.includes(item.category));
    }

    // 2. 再按关键字过滤（标题或内容匹配）
    const searchEl = document.getElementById('memorySearchInput');
    if (searchEl && searchEl.value.trim()) {
        const kw = searchEl.value.trim().toLowerCase();
        filtered = filtered.filter(item =>
            (item.title && item.title.toLowerCase().includes(kw)) ||
            (item.content && item.content.toLowerCase().includes(kw))
        );
    }

    // 按创建时间排序（最新的在前）
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    // 清空四个圆环
    if (ringEast) ringEast.innerHTML = '';
    if (ringNorth) ringNorth.innerHTML = '';
    if (ringWest) ringWest.innerHTML = '';
    if (ringSouth) ringSouth.innerHTML = '';

    if (filtered.length === 0) {
        if (emptyEl) {
            emptyEl.style.display = 'block';
            const p = emptyEl.querySelector('p');
            if (p) {
                if (searchEl && searchEl.value.trim()) {
                    p.textContent = `没有匹配 "${searchEl.value.trim()}" 的笔记`;
                } else {
                    p.textContent = '还没有记忆，点击下方 +记忆 添加你的第一条';
                }
            }
        }
        return;
    } else if (emptyEl) {
        emptyEl.style.display = 'none';
    }

    // 将记忆按索引顺序平均分配到四个方向：北/东/南/西
    // 同时保证每个圆环的卡片数量决定其环上分布角度
    const dirs = ['north', 'east', 'south', 'west'];
    const buckets = { north: [], east: [], south: [], west: [] };

    filtered.forEach((item, idx) => {
        buckets[dirs[idx % 4]].push(item);
    });

    // 为每个圆环填充卡片
    dirs.forEach((dir) => {
        const ringEl = document.getElementById(`memoryRing${dir.charAt(0).toUpperCase() + dir.slice(1)}`);
        if (!ringEl) return;

        const items = buckets[dir];
        if (items.length === 0) {
            // 该象限为空，显示空状态提示
            const emptyBox = document.createElement('div');
            emptyBox.className = 'memory-empty-quad';
            const emojiMap = { north: '🧭', east: '🌅', south: '🌿', west: '🌙' };
            const labelMap = { north: '北', east: '东', south: '南', west: '西' };
            emptyBox.innerHTML = `<span class="emoji">${emojiMap[dir]}</span><span>${labelMap[dir]} · 暂无记忆</span>`;
            ringEl.appendChild(emptyBox);
            return;
        }

        const count = items.length;
        // 根据卡片数计算 translateZ：卡片越多越往外，动态计算适配当前圆环大小
        // 圆周长约 = 2 * PI * radius，每卡片占一份，radius ≈ count * cardWidth / (2 * PI)
        const ringW = ringEl.clientWidth || 180;
        const cardW = ringW * 0.42;
        const radius = Math.max(28, Math.round((cardW / 2) / Math.tan(Math.PI / count)));

        items.forEach((item, i) => {
            const angle = (360 / count) * i;
            const div = document.createElement('div');
            div.className = 'memory-item';
            div.setAttribute('onclick', `event.stopPropagation && event.stopPropagation(); viewMemory(${item.id})`);
            div.style.setProperty('--rotate', `${angle}deg`);
            div.style.setProperty('--tz', `${radius}px`);
            div.innerHTML =
                `<div class="memory-item-tag">1</div>
                 <span class="memory-item-date">${formatDateMemory(item.createdAt)}</span>`;
            ringEl.appendChild(div);
        });
    });
}

/* 辅助：转义 HTML（防止记忆内容破坏布局） */
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* 点击中央控制圆圈：切换粉光/白色状态，同时控制四个圆环一起转动或停止 */
function toggleAllRings() {
    const controlBtn = document.getElementById('memoryQuadControl');
    const rings = [
        document.getElementById('memoryRingNorth'),
        document.getElementById('memoryRingEast'),
        document.getElementById('memoryRingSouth'),
        document.getElementById('memoryRingWest')
    ].filter(Boolean);

    if (rings.length === 0 || !controlBtn) return;

    // 判断当前是否已有圆环在转动
    const anyRunning = rings.some(r => r.classList.contains('running'));
    const willRun = !anyRunning;

    // 如果所有圆环都没有记忆卡片，简单闪烁一下按钮提示
    const hasAnyCards = rings.some(r => r.querySelector('.memory-item'));
    if (!hasAnyCards) {
        controlBtn.animate(
            [
                    { transform: 'translate(-50%, -50%) scale(1)' },
                    { transform: 'translate(-50%, -50%) scale(0.92)' },
                    { transform: 'translate(-50%, -50%) scale(1)' }
            ],
            { duration: 260 }
        );
        return;
    }

    // 切换粉光激活状态（粉光 = 转动中；关闭 = 变回白色/蓝色停止）
    controlBtn.classList.toggle('active', willRun);

    // 同时启动/停止四个圆环
    rings.forEach(ring => {
        // 对于没有卡片的圆环，不改变其状态（保持静止）
        if (!ring.querySelector('.memory-item')) return;

        if (willRun) {
            ring.classList.add('running');
            ring.style.animationPlayState = 'running';
        } else {
            ring.classList.remove('running');
            ring.style.animationPlayState = 'paused';
        }
    });
}

/* 点击方向按钮（兼容保留：单个圆环控制，主要供代码中已存在的 onclick 使用） */
function toggleQuadRotation(dir) {
    const ring = document.getElementById(`memoryRing${dir.charAt(0).toUpperCase() + dir.slice(1)}`);
    if (!ring) return;
    if (!ring.querySelector('.memory-item')) return;

    const isRunning = ring.classList.toggle('running');
    ring.style.animationPlayState = isRunning ? 'running' : 'paused';

    // 若四个圆环都停止了则同步中央按钮状态
    const controlBtn = document.getElementById('memoryQuadControl');
    if (controlBtn) {
        const dirs = ['North', 'East', 'South', 'West'];
        const anyRunning = dirs
            .map(d => document.getElementById('memoryRing' + d))
            .filter(Boolean)
            .some(r => r.classList.contains('running'));
        controlBtn.classList.toggle('active', anyRunning);
    }
}

// 当前浏览筛选类型
let currentBrowseFilter = 'all';
let currentFolderName = null;  // 当前选中的文件夹名称（null 表示显示文件夹列表）

// 文件夹配置：名称、图标、颜色
const FOLDER_CONFIG = [
    { name: '学习笔记', icon: '📚', color: '#7c8cff' },
    { name: '生活感悟', icon: '💭', color: '#c97cff' },
    { name: '工作总结', icon: '💼', color: '#ffb86b' },
    { name: '灵感创意', icon: '✨', color: '#ff6b6b' }
];

// 打开记忆浏览页面（搜索/全部/文件夹/未分类）
// 刷新记忆浏览页标题区域：
// - 文件夹列表页：显示普通白色标题「文件夹」
// - 某个文件夹内：显示绿色标签 + 删除按钮（点击标签可编辑名称）
// - 其他筛选：显示对应的白色标题
function refreshMemoryBrowseTitle() {
    const titleEl = document.getElementById('memoryBrowseTitle');
    const renameEl = document.getElementById('memoryBrowseFolderRename');
    const delBtn = document.getElementById('memoryBrowseFolderDelBtn');
    if (!titleEl) return;

    // 先统一显示标题、隐藏绿色输入框和删除按钮
    titleEl.style.display = '';
    if (renameEl) renameEl.style.display = 'none';
    if (delBtn) delBtn.style.display = 'none';

    const isInFolder = (currentBrowseFilter === 'folder' && !!currentFolderName);

    if (isInFolder) {
        titleEl.textContent = currentFolderName;
        // 改为绿色标签样式（点击可编辑）
        titleEl.classList.add('memory-browse-title-tag');
        if (delBtn) delBtn.style.display = '';
    } else {
        const titles = {
            'search': '搜索记忆',
            'all': '全部记忆',
            'folder': '文件夹',
            'uncategorized': '未分类'
        };
        titleEl.textContent = titles[currentBrowseFilter] || '全部记忆';
        titleEl.classList.remove('memory-browse-title-tag');
    }
}

function openMemoryBrowse(filterType) {
    currentBrowseFilter = filterType;
    currentFolderName = null;  // 重置文件夹选择
    const searchInput = document.getElementById('memoryBrowseSearch');

    // 设置标题显示（普通白色文字）
    refreshMemoryBrowseTitle();
    
    // 如果是搜索模式，清空搜索框并聚焦
    if (searchInput) {
        if (filterType === 'search') {
            searchInput.value = '';
            searchInput.placeholder = '输入标题或日期搜索...';
            setTimeout(() => searchInput.focus(), 100);
        } else {
            searchInput.value = '';
            searchInput.placeholder = '搜索标题或日期...';
        }
    }
    
    // 渲染2D网格
    renderMemoryBrowseResults();
    
    // 切换到浏览页面
    switchPage('memory-browse');
}

// 处理浏览页面的返回按钮
function handleBrowseBack() {
    // 如果当前在某个文件夹内，返回文件夹列表
    if (currentFolderName) {
        currentFolderName = null;
        refreshMemoryBrowseTitle();
        renderMemoryBrowseResults();
        return;
    }
    // 否则返回记忆主页
    switchPage('memory');
    currentBrowseFilter = 'all';
}

// 打开某个文件夹，显示其中的记忆
function openFolder(folderName) {
    currentFolderName = folderName;
    refreshMemoryBrowseTitle();
    renderMemoryBrowseResults();
}

// 将顶部绿色标签切换为输入框，编辑当前文件夹名称
function startRenameBrowseFolder() {
    const titleEl = document.getElementById('memoryBrowseTitle');
    const renameEl = document.getElementById('memoryBrowseFolderRename');
    if (!titleEl || !renameEl) return;

    titleEl.style.display = 'none';
    renameEl.style.display = '';
    renameEl.value = currentFolderName || '';
    renameEl.focus();
    renameEl.select();
}

function commitRenameBrowseFolder() {
    const titleEl = document.getElementById('memoryBrowseTitle');
    const renameEl = document.getElementById('memoryBrowseFolderRename');
    if (!titleEl || !renameEl) return;

    const trimmed = renameEl.value.trim();
    // 恢复显示标题（无论成功或取消）
    titleEl.style.display = '';
    renameEl.style.display = 'none';

    if (!trimmed || trimmed === currentFolderName) {
        refreshMemoryBrowseTitle();
        return;
    }
    if (!currentFolderName) return;

    const folders = getFolderList();
    if (folders.some(f => f.name === trimmed)) {
        alert('该文件夹名称已存在');
        refreshMemoryBrowseTitle();
        return;
    }
    const idx = folders.findIndex(f => f.name === currentFolderName);
    if (idx < 0) {
        refreshMemoryBrowseTitle();
        return;
    }
    const oldName = currentFolderName;
    folders[idx].name = trimmed;
    saveFolderList(folders);
    // 迁移记忆数据
    memoryData.forEach(item => {
        if (item.category === oldName) item.category = trimmed;
    });
    saveMemoryData();
    currentFolderName = trimmed;
    refreshMemoryBrowseTitle();
    renderMemoryBrowseResults();
    refreshMemoryStats();
}

function cancelRenameBrowseFolder() {
    const titleEl = document.getElementById('memoryBrowseTitle');
    const renameEl = document.getElementById('memoryBrowseFolderRename');
    if (!titleEl || !renameEl) return;
    titleEl.style.display = '';
    renameEl.style.display = 'none';
}

function deleteCurrentBrowseFolder() {
    if (!currentFolderName) return;
    const count = memoryData.filter(item => item.category === currentFolderName).length;
    const message = count > 0
        ? `删除文件夹"${currentFolderName}"？其中的 ${count} 条记忆将变为"未分类"。`
        : `确认删除文件夹"${currentFolderName}"？`;
    
    // 使用自定义确认模态框
    openConfirmModal(message, (isDelete) => {
        if (!isDelete) return;  // 取消
        
        // 该文件夹内的记忆变为未分类
        memoryData.forEach(item => {
            if (item.category === currentFolderName) item.category = '';
        });
        saveMemoryData();

        const folders = getFolderList();
        const idx = folders.findIndex(f => f.name === currentFolderName);
        if (idx >= 0) {
            folders.splice(idx, 1);
            saveFolderList(folders);
        }

        currentFolderName = null;
        refreshMemoryBrowseTitle();
        renderMemoryBrowseResults();
        refreshMemoryStats();
    });
}

// 顶部绿色标签（显示在文件夹内）：点击可编辑名称
function initMemoryBrowseTitleInput() {
    const titleEl = document.getElementById('memoryBrowseTitle');
    const renameEl = document.getElementById('memoryBrowseFolderRename');
    if (!titleEl || !renameEl) return;

    // 点击绿色标签 → 进入编辑态（仅当处于某个文件夹内时有效）
    titleEl.addEventListener('click', (e) => {
        if (titleEl.classList.contains('memory-browse-title-tag') && currentFolderName) {
            startRenameBrowseFolder();
        }
    });

    // 输入框按键处理
    renameEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitRenameBrowseFolder();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelRenameBrowseFolder();
        }
    });

    // 失焦时也提交（避免忘记按回车）
    renameEl.addEventListener('blur', (e) => {
        commitRenameBrowseFolder();
    });
}

// 关闭记忆浏览页面，返回记忆主页
function closeMemoryBrowse() {
    switchPage('memory');
    currentBrowseFilter = 'all';
    currentFolderName = null;
}

// 渲染2D网格搜索结果
function renderMemoryBrowseResults() {
    const listEl = document.getElementById('memoryBrowseList');
    const emptyEl = document.getElementById('memoryBrowseEmpty');
    const searchInput = document.getElementById('memoryBrowseSearch');
    
    if (!listEl) return;
    
    // ===== 特殊处理：文件夹模式且未选择具体文件夹时，渲染文件夹图标网格 =====
    if (currentBrowseFilter === 'folder' && !currentFolderName) {
        listEl.innerHTML = '';
        listEl.classList.add('memory-folder-grid');  // 添加文件夹网格样式类

        // 同时刷新主页顶部计数（保证顶部"文件夹"数字与这里的文件夹个数一致）
        refreshMemoryStats();

        const folders = getFolderList();
        // 为名称第一个字符做 emoji 映射；没有 emoji 就用名称首字
        const nameToEmoji = (n) => {
            const map = { '学习笔记': '📚', '生活感悟': '💭', '工作总结': '💼', '灵感创意': '✨' };
            return map[n] || (n && n[0]) || '📁';
        };

        // 工具：用 DOM 元素替代 setAttribute('onclick')，让事件绑定更可靠
        folders.forEach(folder => {
            const count = memoryData.filter(item => item.category === folder.name).length;
            const div = document.createElement('div');
            div.className = 'memory-folder-card';

            // 名称/输入框部分的 HTML 模板
            const isEditing = editingFolderName === folder.name;
            let nameHtml;
            if (isEditing) {
                nameHtml = `
                    <input class="memory-folder-name-input js-folder-name-input"
                           value="${folder.name.replace(/"/g, '&quot;')}"
                           data-folder="${folder.name.replace(/"/g, '&quot;')}">
                `;
            } else {
                nameHtml = `
                    <div class="memory-folder-card-name js-folder-rename"
                         data-folder="${folder.name.replace(/"/g, '&quot;')}">
                        ${folder.name}
                    </div>
                `;
            }

            // 优先使用用户手动选择的 emoji；否则走智能匹配
            const folderEmoji = folder.emoji || nameToEmoji(folder.name);

            div.innerHTML = `
                <button class="memory-folder-del-btn js-folder-delete"
                        data-folder="${folder.name.replace(/"/g, '&quot;')}" aria-label="删除文件夹">×</button>
                <div class="memory-folder-icon-wrapper js-folder-open"
                     data-folder="${folder.name.replace(/"/g, '&quot;')}"
                     style="--folder-color: ${folder.color}">
                    <div class="memory-folder-icon-shape">
                        <div class="memory-folder-icon-back"></div>
                        <div class="memory-folder-icon-front"></div>
                        <div class="memory-folder-icon-emoji">${folderEmoji}</div>
                    </div>
                </div>
                ${nameHtml}
                <div class="memory-folder-card-count">${count} 条</div>
            `;
            listEl.appendChild(div);
        });

        // 绑定事件：用 addEventListener 保证点击可靠
        listEl.querySelectorAll('.js-folder-open').forEach(el => {
            el.addEventListener('click', (e) => {
                const name = el.getAttribute('data-folder');
                openFolder(name);
            });
        });
        // 点击名称/图标卡任何一处都能打开文件夹
        listEl.querySelectorAll('.memory-folder-card').forEach(card => {
            // 如果已经是删除按钮或输入框则不重复绑定
            card.addEventListener('click', (e) => {
                if (e.target.closest('.memory-folder-del-btn')) return;
                if (e.target.closest('.js-folder-name-input')) return;
                if (e.target.closest('.js-folder-rename')) return;  // 双击时由 ondblclick 处理
                const openEl = card.querySelector('.js-folder-open');
                if (openEl) {
                    const name = openEl.getAttribute('data-folder');
                    openFolder(name);
                }
            });
        });
        listEl.querySelectorAll('.js-folder-rename').forEach(el => {
            // 单击绿色标签即可进入编辑态（更直观）
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = el.getAttribute('data-folder');
                startEditFolderName(name, e);
            });
        });
        listEl.querySelectorAll('.js-folder-delete').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = el.getAttribute('data-folder');
                deleteFolder(name, e);
            });
        });
        listEl.querySelectorAll('.js-folder-name-input').forEach(input => {
            input.addEventListener('click', (e) => e.stopPropagation());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEditFolderName(input.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEditFolderName();
                }
            });
            input.addEventListener('blur', (e) => {
                saveEditFolderName(input.value);
            });
            // 自动聚焦并选中文本
            setTimeout(() => { input.focus(); input.select(); }, 20);
        });

        // "+ 新建文件夹" 按钮 — 使用 addEventListener 确保点击可靠
        const addDiv = document.createElement('div');
        addDiv.className = 'memory-folder-card memory-folder-add-card';
        addDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            addNewFolder();
        });
        addDiv.innerHTML = `
            <div class="memory-folder-icon-wrapper memory-folder-add-icon">
                <div class="memory-folder-icon-shape">
                    <div class="memory-folder-icon-back"></div>
                    <div class="memory-folder-icon-front memory-folder-icon-front-add"></div>
                    <div class="memory-folder-icon-emoji">+</div>
                </div>
            </div>
            <div class="memory-folder-card-name memory-folder-add-name">新建文件夹</div>
            <div class="memory-folder-card-count">&nbsp;</div>
        `;
        listEl.appendChild(addDiv);

        if (emptyEl) emptyEl.style.display = 'none';
        return;
    }
    
    // 移除文件夹网格类（还原普通网格）
    listEl.classList.remove('memory-folder-grid');
    
    // 先按筛选类型过滤
    let filtered = memoryData;
    
    if (currentBrowseFilter === 'folder') {
        // 已选择具体文件夹，只显示该文件夹内的记忆
        if (currentFolderName) {
            filtered = memoryData.filter(item => item.category === currentFolderName);
        } else {
            filtered = memoryData.filter(item => item.category && FOLDER_CATEGORIES.includes(item.category));
        }
    } else if (currentBrowseFilter === 'uncategorized') {
        filtered = memoryData.filter(item => !item.category || !FOLDER_CATEGORIES.includes(item.category));
    }
    
    // 搜索模式或有搜索关键词时，进一步按标题/日期过滤
    if (currentBrowseFilter === 'search' || (searchInput && searchInput.value.trim())) {
        if (searchInput && searchInput.value.trim()) {
            const kw = searchInput.value.trim().toLowerCase();
            filtered = filtered.filter(item => {
                const titleMatch = item.title && item.title.toLowerCase().includes(kw);
                const dateStr = formatDateMemory(item.createdAt);
                const dateMatch = dateStr && dateStr.includes(kw);
                return titleMatch || dateMatch;
            });
        }
    }
    
    // 按创建时间排序（最新的在前）
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    
    // 清空列表
    listEl.innerHTML = '';
    
    if (filtered.length === 0) {
        if (emptyEl) emptyEl.style.display = 'block';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        
        // 以2D网格展示
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'memory-browse-card';
            div.setAttribute('onclick', `viewMemory(${item.id})`);

            // 生成文件夹标签（只在卡片所属的文件夹时显示）
            // - 如果在「全部」或「搜索」模式，展示该卡片的文件夹标签
            // - 如果在文件夹内，不展示标签（因为已经知道自己在哪个文件夹里）
            let folderTag = '';
            const shouldShowTag = (currentBrowseFilter === 'all' || currentBrowseFilter === 'search')
                                  && item.category && item.category.trim() !== '';
            if (shouldShowTag) {
                // 获取该文件夹对应的 emoji
                const folders = getFolderList();
                const matched = folders.find(f => f.name === item.category);
                const emoji = (matched && matched.emoji) || getSmartEmoji(item.category);
                folderTag = `
                    <div class="memory-browse-card-tag">
                        <span class="memory-browse-card-tag-emoji">${emoji}</span>
                        <span class="memory-browse-card-tag-name">${item.category}</span>
                    </div>
                `;
            }

            div.innerHTML =
                `${folderTag}
                <h4 class="memory-browse-card-title">${item.title}</h4>
                <p class="memory-browse-card-content">${item.content}</p>
                <div class="memory-browse-card-date">${formatDateMemory(item.createdAt)}</div>`;
            listEl.appendChild(div);
        });
    }
}

// 查看记忆详情
function viewMemory(id) {
    const memory = memoryData.find(m => m.id === id);
    if (!memory) return;

    currentViewingMemoryId = id;
    const titleEl = document.getElementById('memoryDetailTitle');
    const dateEl = document.getElementById('memoryDetailDate');
    const lunarEl = document.getElementById('memoryDetailLunar');
    const contentEl = document.getElementById('memoryDetailContent');
    const titleInput = document.getElementById('memoryDetailTitleInput');
    const contentInput = document.getElementById('memoryDetailContentInput');
    const editBtn = document.getElementById('memoryEditBtn');
    const saveBtn = document.getElementById('memorySaveBtn');

    const date = new Date(memory.createdAt);

    if (titleEl) titleEl.textContent = memory.title;
    if (dateEl) dateEl.textContent = formatDateMemory(memory.createdAt);
    if (lunarEl) lunarEl.textContent = solarToLunar(date);
    if (contentEl) {
        contentEl.textContent = memory.content;
        contentEl.innerHTML = contentEl.innerHTML.replace(/\n/g, '<br>');
    }
    
    // 初始化编辑输入框
    if (titleInput) titleInput.value = memory.title;
    if (contentInput) contentInput.value = memory.content;
    
    // 确保处于查看模式
    if (titleEl) titleEl.style.display = 'block';
    if (titleInput) titleInput.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    if (contentInput) contentInput.style.display = 'none';
    if (editBtn) editBtn.style.display = 'flex';
    if (saveBtn) saveBtn.style.display = 'none';

    switchPage('memory-detail');
}

// 关闭记忆详情页
function closeMemoryDetail() {
    switchPage('memory');
    currentViewingMemoryId = null;
    // 关闭文件夹选择模态框
    const folderModal = document.getElementById('memoryFolderPickerModal');
    if (folderModal) folderModal.style.display = 'none';
}

// 切换文件夹面板显示/隐藏
// 打开/关闭“选择文件夹”模态框，点击文件夹时动态渲染列表
function toggleFolderPanel() {
    const modal = document.getElementById('memoryFolderPickerModal');
    if (!modal) return;
    const isHidden = modal.style.display === 'none' || modal.style.display === '';
    if (isHidden) {
        renderFolderPickerList();
        modal.style.display = 'flex';
    } else {
        modal.style.display = 'none';
    }
}

// 动态渲染“选择文件夹”模态框中的文件夹列表
// 列表内容与文件夹管理页（第二张图）中的文件夹保持同步
function renderFolderPickerList() {
    const listEl = document.getElementById('memoryFolderPickerList');
    if (!listEl) return;
    if (!currentViewingMemoryId) return;
    
    const memory = memoryData.find(m => m.id === currentViewingMemoryId);
    const currentCategory = memory ? (memory.category || '') : '';
    
    // 1) “未分类”总是显示
    let html = '';
    html += buildFolderModalItem('', '未分类', '📋', currentCategory);
    
    // 2) 遍历用户创建的文件夹，按关键词取 emoji
    const folders = getFolderList();
    folders.forEach(folder => {
        const emoji = folder.emoji || getSmartEmoji(folder.name);
        html += buildFolderModalItem(folder.name, folder.name, emoji, currentCategory);
    });
    
    listEl.innerHTML = html;
}

// 生成模态框中单个文件夹选项的 HTML
function buildFolderModalItem(name, displayName, emoji, currentCategory) {
    const isActive = (currentCategory === name || (name === '' && currentCategory === '')) &&
                     (currentCategory === name);
    // 修正：准确比较当前分类
    const match = (name === '' && currentCategory === '') || (name !== '' && name === currentCategory);
    return `
        <div class="memory-folder-modal-d-item${match ? ' is-active' : ''}"
             onclick="moveMemoryToFolder('${name.replace(/'/g, "\\'")}')">
            <span class="memory-folder-modal-d-icon">${emoji}</span>
            <span class="memory-folder-modal-d-name">${displayName}</span>
        </div>
    `;
}

// 将记忆移动到指定文件夹
function moveMemoryToFolder(category) {
    if (!currentViewingMemoryId) return;
    
    const memory = memoryData.find(m => m.id === currentViewingMemoryId);
    if (memory) {
        memory.category = category || '';
        memory.updatedAt = Date.now();
        saveMemoryData();
        renderMemoryList();
        
        // 关闭文件夹选择模态框
        const modal = document.getElementById('memoryFolderPickerModal');
        if (modal) modal.style.display = 'none';
        
        // 更新详情页显示的分类信息
        const metaEl = document.querySelector('#page-memory-detail .memory-detail-meta');
        if (metaEl && category) {
            const categorySpan = metaEl.querySelector('.memory-detail-category');
            if (categorySpan) {
                categorySpan.textContent = category;
            } else {
                const newSpan = document.createElement('span');
                newSpan.className = 'memory-detail-category';
                newSpan.textContent = category;
                metaEl.appendChild(newSpan);
            }
        }
    }
}

// ===== AI输入功能 =====

// 打开AI输入模态框
function openMemoryAiInput() {
    const modal = document.getElementById('memoryAiModal');
    if (!modal) return;
    modal.style.display = 'flex';
    setTimeout(() => {
        const input = document.getElementById('memoryAiPromptInput');
        if (input) input.focus();
    }, 50);
}

function closeMemoryAiInput() {
    const modal = document.getElementById('memoryAiModal');
    if (modal) {
        modal.style.display = 'none';
        const input = document.getElementById('memoryAiPromptInput');
        if (input) input.value = '';
        resetMemoryAiBtn();
    }
}

function fillAiPrompt(text) {
    const input = document.getElementById('memoryAiPromptInput');
    if (input) {
        input.value = text;
        input.focus();
    }
}

function resetMemoryAiBtn() {
    const btn = document.getElementById('memoryAiGenBtn');
    if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
    const textEl = document.querySelector('.memory-ai-btn-text');
    const spinnerEl = document.querySelector('.memory-ai-btn-spinner');
    if (textEl) textEl.style.display = 'inline';
    if (spinnerEl) spinnerEl.style.display = 'none';
}

// AI内容生成核心逻辑
function generateMemoryContent(userPrompt) {
    const prompt = (userPrompt || '').toLowerCase().trim();
    const rawPrompt = userPrompt || '';

    const templates = [
        {
            keywords: ['学习', '笔记', '读书', '书', '知识', '课程', '考试', '复习', '英语', '数学', '编程', '代码'],
            title: '今日学习笔记',
            contents: [
                '今天专注学习了一整个下午。关于「坚持」这件事，我有了新的理解：\n\n学习不是短跑，而是一场马拉松。刚开始的时候，速度不重要，持续才是关键。\n\n把大目标拆成每天能完成的小任务，一步一步往前走，终会抵达想去的地方。',
                '读书的意义不在于记住了多少内容，而在于它在多大程度上塑造了我们的思维。\n\n每一本好书，都是一次与优秀灵魂的对话。那些读过的文字，会在某个不经意的瞬间，成为我们人生的答案。',
                '代码是诗人的语言。每一行看似冰冷的逻辑背后，都藏着构建者对世界的理解。\n\n今天学到的新知识：保持好奇，保持谦卑，保持对未知的敬畏。'
            ]
        },
        {
            keywords: ['生活', '日常', '随笔', '心情', '感悟', '心得', '感受', '日记'],
            title: '生活随笔',
            contents: [
                '生活的美好，往往藏在最平凡的瞬间里。\n\n清晨的第一缕阳光、午后的一杯咖啡、傍晚时分的微风……这些看似不起眼的时刻，组成了我们真正的人生。\n\n学会看见，是一种重要的能力。',
                '今天又多了一点对生活的理解：\n\n不必羡慕别人的精彩，每个人都有自己的节奏。慢一点没关系，只要走的方向是对的。\n\n把每一天都认真过好，就是对生活最好的回应。',
                '窗外的世界很喧嚣，但内心可以很安静。\n\n记录下此刻的心情，是送给未来自己的一份礼物。这些文字，是我存在过、感受过、生活过的证明。'
            ]
        },
        {
            keywords: ['工作', '办公', '会议', '报告', '项目', '任务', '计划', '总结', '周报', '日报'],
            title: '工作小结',
            contents: [
                '本周完成事项：\n\n1. 完成核心功能开发\n2. 参与需求评审会议，理清后续方向\n3. 梳理并优化了工作流程\n\n反思：时间分配上还可以更合理。下周要加强对高优先级任务的聚焦。',
                '今日思考：工作不只是任务的完成，更是持续自我精进的过程。\n\n每一次挑战，都是成长的契机；每一次沟通，都是理解的桥梁。保持专业，保持热情。',
                '工作复盘：\n\n• 做得好的地方：按时交付了核心任务\n• 需要改进的地方：前期规划可以更细致\n• 下周目标：提升效率，减少返工'
            ]
        },
        {
            keywords: ['灵感', '创意', '脑洞', '点子', '想法', '设计'],
            title: '创意灵感',
            contents: [
                '灵感不会凭空出现。它是长期积累后的一次爆发。\n\n保持对世界的好奇，保持对生活的敏感。那些看似无关的事物，也许某天会串联成一条独特的思路。\n\n记录下来，是抓住灵感最好的方式。',
                '一个好的创意，往往来自于跨界。\n\n把A领域的思维用到B领域，往往能产生意想不到的化学反应。保持开放，保持连接。',
                '今日灵感：\n\n创意不是等待，而是行动。\n\n想到了就写下来，写下来了就去尝试。灵感是流动的，只会在行动中被捕获。'
            ]
        },
        {
            keywords: ['激励', '加油', '鼓励', '梦想', '目标', '奋斗', '坚持', '正能量', '励志'],
            title: '写给自己',
            contents: [
                '你已经走了很远了，不要停下来。\n\n那些你以为熬不过的日子，回头看时都已经成为过去。你比自己想象中更坚强。\n\n继续往前走，光就在前方。',
                '每一个优秀的人，都曾经历过一段不被理解的时光。\n\n但正是那段时间，让他们积蓄了力量，最终脱颖而出。\n\n你现在的坚持，是在为未来铺路。',
                '你不需要成为别人，只需要成为更好的自己。\n\n每一天都比昨天进步一点，就是最好的状态。\n\n相信时间的力量，也相信你自己。'
            ]
        },
        {
            keywords: ['旅行', '旅游', '出行', '游记', '风景', '打卡'],
            title: '旅行日记',
            contents: [
                '旅行的意义，不在于走了多远，而在于内心走了多远。\n\n每到一个新地方，都是一次与陌生文化的对话，也是一次重新认识自己的过程。\n\n在路上，永远年轻。',
                '今天看到的风景，想写下来记一辈子。\n\n有些感受，只有亲自抵达才能理解。那些被拍下的照片，是记忆的锚点；而写下的文字，是心灵的地图。',
                '走过的路，看过的风景，遇过的人……都是旅途中最珍贵的收获。\n\n愿我始终保有出发的勇气，和归来的温柔。'
            ]
        },
        {
            keywords: ['美食', '菜谱', '烹饪', '吃饭', '餐厅', '早餐', '晚餐'],
            title: '美食记录',
            contents: [
                '好好吃饭，是最朴素也最深沉的幸福。\n\n食物承载着记忆，承载着对生活的热爱。每一餐都值得被认真对待。\n\n今天的这顿饭，值得被记录。',
                '美食是治愈生活的良药。\n\n忙碌的一天结束后，用一顿精心准备的饭菜犒劳自己，是最温柔的仪式。',
                '记录下今天吃的每一口，都是对平凡生活的热爱。\n\n食物带来的不只是饱腹感，还有被好好对待的感觉。'
            ]
        },
        {
            keywords: ['回忆', '记忆', '过去', '童年', '怀念', '往事', '老'],
            title: '回忆往事',
            contents: [
                '有些记忆，不会因为时间而褪色。\n\n那些年一起走过的路、一起笑过的人、一起追逐过的梦想……都被时间酿成了酒，在某个时刻想起，依然温暖。',
                '回忆是时间留给我们的礼物。\n\n回望过去，不是为了沉溺其中，而是为了更清楚地看见自己是如何一步步走来的。\n\n感恩所有的遇见。',
                '翻开旧日记，像是与过去的自己对话。\n\n那些曾经以为天大的事，如今看来都云淡风轻。时间教会我的，是成长，也是释怀。'
            ]
        }
    ];

    const defaultTemplates = [
        {
            title: '今日所思',
            contents: [
                '今天想记录一点什么。\n\n生活中总有一些瞬间值得被记住：可能是一句触动的话，一个温暖的眼神，或是一瞬间的恍然大悟。\n\n把它们写下来，让记忆有迹可循。',
                '写点东西的意义，或许是为了让未来的自己知道——此刻的我，在想些什么。\n\n这些文字不是日记，而是心灵的快照。',
                '安静的时刻，思绪万千。\n\n记录下来，是一种仪式，也是一种释放。愿文字成为我与世界对话的方式。'
            ]
        }
    ];

    let matched = null;
    for (const tpl of templates) {
        if (tpl.keywords.some(kw => prompt.includes(kw) || rawPrompt.includes(kw))) {
            matched = tpl;
            break;
        }
    }
    if (!matched) {
        matched = defaultTemplates[0];
    }

    const contents = matched.contents;
    const content = contents[Math.floor(Math.random() * contents.length)];

    let title = matched.title;
    if (rawPrompt && rawPrompt.trim().length > 0 && rawPrompt.trim().length <= 10) {
        title = rawPrompt.trim();
    }

    return {
        title: title,
        content: content
    };
}

// 执行AI内容生成，并将结果填入记忆的标题和内容
function runMemoryAiGeneration() {
    const input = document.getElementById('memoryAiPromptInput');
    if (!input) return;

    const prompt = input.value.trim();
    if (!prompt) {
        alert('请输入你的指令或想法');
        input.focus();
        return;
    }

    // 显示生成中状态
    const btn = document.getElementById('memoryAiGenBtn');
    const textEl = document.querySelector('.memory-ai-btn-text');
    const spinnerEl = document.querySelector('.memory-ai-btn-spinner');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }
    if (textEl) textEl.style.display = 'none';
    if (spinnerEl) spinnerEl.style.display = 'inline';

    setTimeout(() => {
        const result = generateMemoryContent(prompt);

        // 如果当前正在查看记忆，则自动进入编辑模式并填入内容
        if (currentViewingMemoryId) {
            const titleEl = document.getElementById('memoryDetailTitle');
            const titleInput = document.getElementById('memoryDetailTitleInput');
            const contentEl = document.getElementById('memoryDetailContent');
            const contentInput = document.getElementById('memoryDetailContentInput');
            const editBtn = document.getElementById('memoryEditBtn');
            const saveBtn = document.getElementById('memorySaveBtn');

            if (titleEl) titleEl.style.display = 'none';
            if (titleInput) {
                titleInput.style.display = 'block';
                titleInput.value = result.title;
            }
            if (contentEl) contentEl.style.display = 'none';
            if (contentInput) {
                contentInput.style.display = 'block';
                contentInput.value = result.content;
            }
            if (editBtn) editBtn.style.display = 'none';
            if (saveBtn) saveBtn.style.display = 'flex';
        }

        // 关闭AI模态框
        closeMemoryAiInput();
    }, 800);
}

// 切换详情页编辑模式
function toggleMemoryDetailEdit() {
    const titleEl = document.getElementById('memoryDetailTitle');
    const titleInput = document.getElementById('memoryDetailTitleInput');
    const contentEl = document.getElementById('memoryDetailContent');
    const contentInput = document.getElementById('memoryDetailContentInput');
    const editBtn = document.getElementById('memoryEditBtn');
    const saveBtn = document.getElementById('memorySaveBtn');

    const isEditing = titleInput && titleInput.style.display !== 'none';

    if (isEditing) {
        // 切换回查看模式
        if (titleEl) titleEl.style.display = 'block';
        if (titleInput) titleInput.style.display = 'none';
        if (contentEl) contentEl.style.display = 'block';
        if (contentInput) contentInput.style.display = 'none';
        if (editBtn) editBtn.style.display = 'flex';
        if (saveBtn) saveBtn.style.display = 'none';
    } else {
        // 切换到编辑模式
        if (titleEl) titleEl.style.display = 'none';
        if (titleInput) {
            titleInput.style.display = 'block';
            titleInput.focus();
        }
        if (contentEl) contentEl.style.display = 'none';
        if (contentInput) {
            contentInput.style.display = 'block';
        }
        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'flex';
    }
}

// 保存详情页编辑
function saveMemoryDetailEdit() {
    if (!currentViewingMemoryId) return;

    const titleInput = document.getElementById('memoryDetailTitleInput');
    const contentInput = document.getElementById('memoryDetailContentInput');
    
    if (!titleInput || !contentInput) return;

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title) {
        alert('请输入标题');
        titleInput.focus();
        return;
    }
    if (!content) {
        alert('请输入内容');
        contentInput.focus();
        return;
    }

    // 更新记忆数据
    const memory = memoryData.find(m => m.id === currentViewingMemoryId);
    if (memory) {
        memory.title = title;
        memory.content = content;
        memory.updatedAt = Date.now();
        saveMemoryData();
        renderMemoryList();
        
        // 切换回查看模式并更新显示
        const titleEl = document.getElementById('memoryDetailTitle');
        const contentEl = document.getElementById('memoryDetailContent');
        const editBtn = document.getElementById('memoryEditBtn');
        const saveBtn = document.getElementById('memorySaveBtn');

        if (titleEl) {
            titleEl.textContent = title;
            titleEl.style.display = 'block';
        }
        if (titleInput) titleInput.style.display = 'none';
        if (contentEl) {
            contentEl.textContent = content;
            contentEl.innerHTML = contentEl.innerHTML.replace(/\n/g, '<br>');
            contentEl.style.display = 'block';
        }
        if (contentInput) contentInput.style.display = 'none';
        if (editBtn) editBtn.style.display = 'flex';
        if (saveBtn) saveBtn.style.display = 'none';
    }
}

// 删除当前查看的记忆
function deleteCurrentMemoryDetail() {
    if (!currentViewingMemoryId) return;
    const confirmed = confirm('确定要删除这条记忆吗？');
    if (!confirmed) return;
    memoryData = memoryData.filter(m => m.id !== currentViewingMemoryId);
    saveMemoryData();
    renderMemoryList();
    closeMemoryDetail();
}

// 分享记忆（完整实现）
function shareMemoryDetail() {
    if (!currentViewingMemoryId) return;
    
    const memory = memoryData.find(m => m.id === currentViewingMemoryId);
    if (!memory) return;
    
    const title = memory.title;
    const content = memory.content;
    const text = `${title}\n\n${content}`;
    
    // 优先使用原生分享API
    if (navigator.share) {
        navigator.share({
            title: title,
            text: text
        }).then(() => {
            console.log('分享成功');
        }).catch((err) => {
            console.log('分享取消或失败:', err);
        });
    } else if (navigator.clipboard) {
        // 降级到剪贴板
        navigator.clipboard.writeText(text).then(() => {
            alert('内容已复制到剪贴板，您可以粘贴分享给好友');
        }).catch((err) => {
            console.error('复制失败:', err);
            // 再降级到手动选择
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                alert('内容已复制到剪贴板');
            } catch (e) {
                alert('分享功能暂不可用，您可以手动复制内容');
            }
            document.body.removeChild(textarea);
        });
    } else {
        // 最后的降级方案
        alert('分享功能暂不可用，您可以手动复制内容');
    }
}

function isToday(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    return date.toDateString() === today.toDateString();
}

function formatDateMemory(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 259200000) return Math.floor(diff / 86400000) + '天前';

    return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function solarToLunar(date) {
    const lunarMonths = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
    const lunarDays = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
                      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
                      '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
    
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    const lunarInfo = [
        0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
        0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
        0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
        0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
        0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
        0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052d0, 0x0a9a8, 0x0e950, 0x06aa0,
        0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
        0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
        0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
        0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
        0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
        0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
        0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
        0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
        0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0
    ];
    
    const solarMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const Gan = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
    const Zhi = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    
    let i, leap = 0, temp = 0;
    let baseYear = 1900;
    let baseMonth = 1;
    let baseDay = 31;
    
    if ((year < 1900) || (year > 2100)) {
        return '未知';
    }
    
    if (year == 1900 && month == 1 && day < 31) {
        return '未知';
    }
    
    let offset = 0;
    for (i = 1900; i < year; i++) {
        temp = (lunarInfo[i - 1900] & 0x0fff);
        offset += (temp == 0x0000) ? 354 : 384;
    }
    
    for (i = 1; i < month; i++) {
        temp = (lunarInfo[year - 1900] & (0x10000 >> i));
        offset += (temp == 0) ? solarMonth[i - 1] : (i == leap ? 30 : 29);
    }
    
    offset += (day - 1);
    
    let lunarYear = 1900;
    while (lunarYear <= 2100 && offset > 0) {
        temp = (lunarInfo[lunarYear - 1900] & 0x0fff);
        leap = (lunarInfo[lunarYear - 1900] & 0xf0000) >> 16;
        temp = (temp == 0x0000) ? 354 : 384;
        offset -= temp;
        lunarYear++;
    }
    
    if (offset < 0) {
        offset += temp;
        lunarYear--;
    }
    
    temp = (lunarInfo[lunarYear - 1900] & 0x0fff);
    leap = (lunarInfo[lunarYear - 1900] & 0xf0000) >> 16;
    
    let lunarMonth = 1;
    while (lunarMonth <= 12 && offset > 0) {
        if (leap > 0 && lunarMonth == (leap + 1) && offset > 29) {
            offset -= 30;
            lunarMonth++;
        }
        
        let daysInMonth = (lunarInfo[lunarYear - 1900] & (0x10000 >> lunarMonth)) == 0 ? 30 : 29;
        offset -= daysInMonth;
        lunarMonth++;
    }
    
    if (offset == 0 && leap > 0 && lunarMonth == leap + 1) {
        if (leap > lunarMonth) {
            lunarMonth--;
        }
        leap = 0;
    }
    
    if (offset < 0) {
        offset += (lunarInfo[lunarYear - 1900] & (0x10000 >> lunarMonth)) == 0 ? 30 : 29;
        lunarMonth--;
    }
    
    let lunarDay = offset + 1;
    
    return `${lunarMonths[lunarMonth - 1]}月${lunarDays[lunarDay]}`;
}

function filterMemory(category, element) {
    currentMemoryCategory = category;

    // 更新三个筛选按钮的选中状态
    document.querySelectorAll('.memory-filter-btn').forEach(el => el.classList.remove('active'));
    if (element) element.classList.add('active');

    renderMemoryList();
}

function formatDateMemoryFull(timestamp) {
    const date = new Date(timestamp);
    const weekDays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]}`;
}

let currentMemoryAddStyle = 'paper';

function showAddMemoryModal() {
    const titleInput = document.getElementById('memoryAddTitle');
    const contentInput = document.getElementById('memoryAddContent');
    const dateEl = document.getElementById('memoryAddDate');

    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    if (dateEl) dateEl.textContent = formatDateMemoryFull(Date.now());

    currentMemoryAddStyle = 'paper';
    const paper = document.querySelector('#page-memory-add .memory-detail-paper');
    if (paper) {
        paper.classList.remove('mindmap-style', 'personal-style');
    }

    switchPage('memory-add');
}

function closeMemoryAdd() {
    switchPage('memory');
}

function shareMemoryAdd() {
    const titleInput = document.getElementById('memoryAddTitle');
    const contentInput = document.getElementById('memoryAddContent');
    if (!titleInput || !contentInput) return;
    const text = `${titleInput.value || '未命名记忆'}\n\n${contentInput.value || ''}`;
    if (navigator.share) {
        navigator.share({ title: titleInput.value || '记忆', text: text }).catch(() => {});
    } else {
        navigator.clipboard.writeText(text).then(() => {
            alert('已复制到剪贴板');
        }).catch(() => {
            alert('分享功能已触发');
        });
    }
}

function toggleMemoryAddStyle() {
    const paper = document.querySelector('#page-memory-add .memory-detail-paper');
    if (!paper) return;
    if (paper.classList.contains('personal-style')) {
        paper.classList.remove('personal-style');
        currentMemoryAddStyle = 'paper';
    } else {
        paper.classList.add('personal-style');
        currentMemoryAddStyle = 'personal';
    }
}

function showMemoryMindmap() {
    const paper = document.querySelector('#page-memory-add .memory-detail-paper');
    if (!paper) return;
    if (paper.classList.contains('mindmap-style')) {
        paper.classList.remove('mindmap-style');
    } else {
        paper.classList.add('mindmap-style');
    }
}

function saveNewMemory() {
    const titleInput = document.getElementById('memoryAddTitle');
    const contentInput = document.getElementById('memoryAddContent');

    if (!titleInput || !contentInput) return;

    const title = titleInput.value.trim();
    const content = contentInput.value.trim();

    if (!title) {
        alert('请输入标题');
        return;
    }
    if (!content) {
        alert('请输入内容');
        return;
    }

    const newMemory = {
        id: Date.now(),
        title: title,
        content: content,
        category: '其他',
        createdAt: Date.now()
    };

    memoryData.unshift(newMemory);
    saveMemoryData();
    renderMemoryList();
    switchPage('memory');
}

function editMemory(id) {
    const memory = memoryData.find(m => m.id === id);
    if (!memory) return;

    editingMemoryId = id;
    selectedCategory = memory.category;
    const modal = document.getElementById('memoryModal');
    const title = document.getElementById('memoryModalTitle');
    const titleInput = document.getElementById('memoryTitleInput');
    const contentInput = document.getElementById('memoryContentInput');
    const delBtn = document.getElementById('memoryModalDeleteBtn');

    if (title) title.textContent = '编辑记忆';
    if (titleInput) titleInput.value = memory.title;
    if (contentInput) contentInput.value = memory.content;
    if (delBtn) {
        delBtn.style.display = 'inline-block';
        delBtn.style.color = '#ff6b6b';
        delBtn.style.borderColor = 'rgba(255, 107, 107, 0.3)';
    }

    updateCategorySelect();

    if (modal) modal.classList.add('show');
}

// 从编辑弹窗内调用删除
function deleteCurrentMemory() {
    if (!editingMemoryId) return;
    const confirmed = confirm('确定要删除这条记忆吗？');
    if (!confirmed) return;
    memoryData = memoryData.filter(m => m.id !== editingMemoryId);
    saveMemoryData();
    renderMemoryList();
    const modal = document.getElementById('memoryModal');
    if (modal) modal.classList.remove('show');
    editingMemoryId = null;
}

function selectMemoryCategory(element, category) {
    selectedCategory = category;
    updateCategorySelect();
}

function updateCategorySelect() {
    const selects = document.querySelectorAll('#memoryCategorySelect .category-select');
    selects.forEach(el => {
        const cat = el.textContent.trim().replace(/^[^\s]+\s/, '');
        if (cat === selectedCategory) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

function saveMemory() {
    const titleInput = document.getElementById('memoryTitleInput');
    const contentInput = document.getElementById('memoryContentInput');

    const title = titleInput ? titleInput.value.trim() : '';
    const content = contentInput ? contentInput.value.trim() : '';

    if (!title) {
        alert('请输入标题');
        return;
    }
    if (!content) {
        alert('请输入内容');
        return;
    }

    if (editingMemoryId) {
        // 编辑现有记忆
        const memory = memoryData.find(m => m.id === editingMemoryId);
        if (memory) {
            memory.title = title;
            memory.content = content;
            memory.category = selectedCategory;
        }
    } else {
        // 添加新记忆
        const newId = memoryData.length > 0 ? Math.max(...memoryData.map(m => m.id)) + 1 : 1;
        memoryData.push({
            id: newId,
            title: title,
            content: content,
            category: selectedCategory,
            createdAt: Date.now()
        });
    }

    saveMemoryData();
    renderMemoryList();

    const modal = document.getElementById('memoryModal');
    if (modal) modal.classList.remove('show');
}

function deleteMemory(id) {
    const memory = memoryData.find(m => m.id === id);
    if (!memory) return;

    const confirmed = confirm('确定要删除这条记忆吗？');
    if (!confirmed) return;

    memoryData = memoryData.filter(m => m.id !== id);
    saveMemoryData();
    renderMemoryList();
}

function closeMemoryModal(event) {
    if (!event || event.target.classList.contains('memory-modal')) {
        const modal = document.getElementById('memoryModal');
        if (modal) modal.classList.remove('show');
    }
}

// 初始化记忆数据
loadMemoryData();
