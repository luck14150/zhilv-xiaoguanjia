/* ============ 智律小管家 ============ */

/* ============ Agnes AI API 配置 ============ */
const AGNES_CONFIG = {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-tIQbtS4899pY8zv4mtL7iAf5nBLpD6NY5AWVv8ho4vADZxZb',
    model: 'agnes-2.0-flash'
};

/* ============ 多设备同步（localStorage + 云端）============ */
const STORAGE_KEY = 'zhilv_data_v1';

function loadData() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : { alarms: [], schedule: [], memory: [], stats: {} };
    } catch (e) {
        return { alarms: [], schedule: [], memory: [], stats: {} };
    }
}

function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/* ============ 实时时钟 & 闹钟功能（HH:MM:SS） ============ */
let alarmTimers = [];

function updateClockDisplay() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const dateEl = document.getElementById('clockTime');
    if (dateEl) {
        dateEl.innerHTML = `${h}<span class="clock-sep">:</span>${m}<span class="clock-sep">:</span>${s}`;
    }

    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];
    const dateStrEl = document.getElementById('clockDate');
    if (dateStrEl) {
        dateStrEl.textContent = `${year}年${month}月${day}日 ${weekday}`;
    }
}

function checkAlarms() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const dayOfWeek = now.getDay();

    const alarms = document.querySelectorAll('.alarm-row');
    alarms.forEach(row => {
        const timeEl = row.querySelector('.alarm-time');
        const switchEl = row.querySelector('.alarm-switch');
        if (!timeEl || !switchEl) return;

        const alarmData = getAlarmDataFromRow(row);
        if (!alarmData) return;

        if (!switchEl.classList.contains('off') && alarmData.enabled !== false) {
            const matchesTime = alarmData.time === currentTime;
            const matchesDay = isDayMatch(alarmData.repeat, dayOfWeek);
            if (matchesTime && matchesDay) {
                triggerAlarm(row, alarmData);
            }
        }
    });
}

function isDayMatch(repeat, dayOfWeek) {
    if (!repeat || repeat === 'daily' || repeat === 'once') return true;
    if (repeat === 'workday') return dayOfWeek >= 1 && dayOfWeek <= 5;
    if (repeat === 'weekend') return dayOfWeek === 0 || dayOfWeek === 6;
    if (repeat === 'custom' && Array.isArray(alarmCustomDays)) {
        return alarmCustomDays.includes(dayOfWeek);
    }
    return true;
}

function getAlarmDataFromRow(row) {
    try {
        const id = row.dataset.id;
        const data = loadData();
        return data.alarms.find(a => a._id === id || a.id === id) || null;
    } catch(e) {
        return null;
    }
}

function triggerAlarm(row, alarmData) {
    if ('Notification' in window && Notification.permission === 'granted') {
        const body = alarmData.name ? `${alarmData.name} - 时间到了！` : '闹钟响了！';
        new Notification('⏰ 智律小管家', { body });
    }

    // 震动
    if (alarmData.vibrate && navigator.vibrate) {
        navigator.vibrate([300, 100, 300, 100, 300]);
    }

    // 播放铃声
    playAlarmSound(alarmData.tone || 'classic');
}

function playAlarmSound(tone) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        switch(tone) {
            case 'birds':
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.1);
                osc.frequency.linearRampToValueAtTime(900, ctx.currentTime + 0.2);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                break;
            case 'digital':
                osc.type = 'square';
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
                gain.gain.setValueAtTime(0.2, ctx.currentTime);
                break;
            case 'nature':
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(400, ctx.currentTime + 0.5);
                gain.gain.setValueAtTime(0.2, ctx.currentTime);
                break;
            case 'chime':
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(523, ctx.currentTime);
                osc.frequency.setValueAtTime(659, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.25, ctx.currentTime);
                break;
            case 'rooster':
                osc.frequency.setValueAtTime(300, ctx.currentTime);
                osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.1);
                osc.frequency.linearRampToValueAtTime(500, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                break;
            default: // classic
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, ctx.currentTime);
                osc.frequency.setValueAtTime(440, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
        }

        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1.5);

        setTimeout(() => { try { ctx.close(); } catch(e) {} }, 2000);
    } catch(e) {
        console.log('无法播放闹钟音效', e);
    }
}

// 请求通知权限
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

/* ============ Agnes AI 对话功能 ============ */
async function sendToAI(userMessage) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;

    // 添加用户消息
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-msg ai-user';
    userMsg.innerHTML = `
        <div class="ai-bubble">
            <p>${userMessage}</p>
        </div>
        <div class="ai-avatar">👤</div>
    `;
    chatArea.appendChild(userMsg);
    chatArea.scrollTop = chatArea.scrollHeight;

    // 添加加载动画
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ai-msg ai-bot';
    loadingMsg.id = 'aiLoading';
    loadingMsg.innerHTML = `
        <div class="ai-avatar">🤖</div>
        <div class="ai-bubble">
            <div class="ai-typing"><span></span><span></span><span></span></div>
        </div>
    `;
    chatArea.appendChild(loadingMsg);
    chatArea.scrollTop = chatArea.scrollHeight;

    try {
        const response = await fetch(`${AGNES_CONFIG.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AGNES_CONFIG.apiKey}`
            },
            body: JSON.stringify({
                model: AGNES_CONFIG.model,
                messages: [
                    { role: 'system', content: '你是智律小管家的AI助手，帮助用户管理时间、养成习惯、规划作息。回答要简洁友好，用中文。' },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7
            })
        });

        loadingMsg.remove();

        if (!response.ok) {
            throw new Error(`API 错误: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。';

        // 添加 AI 回复
        const botMsg = document.createElement('div');
        botMsg.className = 'ai-msg ai-bot';
        botMsg.innerHTML = `
            <div class="ai-avatar">🤖</div>
            <div class="ai-bubble">
                <p>${aiResponse.replace(/\n/g, '<br>')}</p>
            </div>
        `;
        chatArea.appendChild(botMsg);
        chatArea.scrollTop = chatArea.scrollHeight;

        // 保存对话到本地存储（跨设备同步
        const savedData = loadData();
        savedData.memory.push({
            role: 'user',
            content: userMessage,
            time: new Date().toISOString()
        });
        savedData.memory.push({
            role: 'ai',
            content: aiResponse,
            time: new Date().toISOString()
        });
        saveData(savedData);

    } catch (error) {
        loadingMsg.remove();
        const errorMsg = document.createElement('div');
        errorMsg.className = 'ai-msg ai-bot';
        errorMsg.innerHTML = `
            <div class="ai-avatar">⚠️</div>
            <div class="ai-bubble">
                <p style="color: #ff6b6b;">连接失败: ${error.message}</p>
            </div>
        `;
        chatArea.appendChild(errorMsg);
    }
}

/* ============ PWA 安装提示 ============ */
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('installBtn');
    if (installBtn) {
        installBtn.style.display = 'inline-block';
        installBtn.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installBtn.style.display = 'none';
            }
            deferredPrompt = null;
        });
    }
});

/* ============ 跨标签页/设备同步（storage 事件）============ */
window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
        console.log('检测到其他标签页的数据变化，正在重新加载闹钟...');
        renderSavedAlarms();
    }
});

/* ============ 闹钟持久化 ============ */
function renderSavedAlarms() {
    const data = loadData();
    const alarmPanel = document.getElementById('alarmPanel');
    if (!alarmPanel || !data.alarms || data.alarms.length === 0) return;

    // 清空非默认闹钟
    const existing = alarmPanel.querySelectorAll('.alarm-row.saved');
    existing.forEach(el => el.remove());

    const defaultRows = alarmPanel.querySelectorAll('.alarm-row:not(.saved)');
    const addBtn = document.getElementById('addAlarmBtn');
    const insertBefore = defaultRows.length > 0 ? defaultRows[defaultRows.length - 1].nextSibling : addBtn;

    data.alarms.forEach((alarm, idx) => {
        const [h, m, s] = (alarm.time || '00:00:00').split(':');
        const sec = s || '00';
        const newAlarm = document.createElement('div');
        newAlarm.className = 'alarm-row saved';
        newAlarm.dataset.id = alarm._id || alarm.id || ('saved_' + idx);

        const repeatLabel = getRepeatLabel(alarm.repeat);
        const switchOn = alarm.enabled !== false;

        newAlarm.innerHTML = `
            <div class="alarm-time">${String(h).padStart(2, '0')}<span class="sep">:</span>${String(m).padStart(2, '0')}<span class="sec-part"><span class="sep">:</span>${String(sec).padStart(2, '0')}</span></div>
            <div class="alarm-info">
                <div class="alarm-name">${alarm.name || '闹钟'}</div>
                <div class="alarm-detail">${repeatLabel}</div>
            </div>
            <div class="alarm-switch ${switchOn ? '' : 'off'}">${switchOn ? 'ON' : 'OFF'}</div>
        `;

        alarmPanel.insertBefore(newAlarm, addBtn);

        // 开关事件
        const sw = newAlarm.querySelector('.alarm-switch');
        sw.addEventListener('click', function(e) {
            e.stopPropagation();
            this.classList.toggle('off');
            const isOn = !this.classList.contains('off');
            this.textContent = isOn ? 'ON' : 'OFF';
            updateAlarmEnabled(newAlarm.dataset.id, isOn);
        });

        // 点击行体 → 打开详情弹窗
        newAlarm.addEventListener('click', function(e) {
            if (e.target === sw || sw.contains(e.target)) return;
            openAlarmModal(newAlarm.dataset.id);
        });
    });
}

function getRepeatLabel(repeat) {
    if (!repeat || repeat === 'daily') return '每日';
    if (repeat === 'workday') return '工作日';
    if (repeat === 'weekend') return '周末';
    if (repeat === 'once') return '仅一次';
    if (repeat === 'custom') return '自定义';
    return repeat;
}

function updateAlarmEnabled(id, enabled) {
    const data = loadData();
    const alarm = data.alarms.find(a => (a._id || a.id) === id);
    if (alarm) {
        alarm.enabled = enabled;
        saveData(data);
    }
}

/* ============ Service Worker 注册（关闭网页也能响铃）============ */
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker 注册成功:', registration);

            // 启动后将闹钟信息传给 Service Worker，实现"关闭网页也能响铃"
            syncAlarmsToServiceWorker();
        } catch (err) {
            console.log('Service Worker 注册失败:', err);
        }
    }
}

// 将闹钟同步到 Service Worker（支持关闭网页后触发通知）
function syncAlarmsToServiceWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;

    // 先把 DOM 中的闹钟更新到 localStorage
    const rows = document.querySelectorAll('.alarm-row');
    const alarmList = [];
    rows.forEach(row => {
        const timeEl = row.querySelector('.alarm-time');
        const nameEl = row.querySelector('.alarm-name');
        const switchEl = row.querySelector('.alarm-switch');
        if (!timeEl || !switchEl) return;
        const time = timeEl.textContent.replace(/[^\d:]/g, '');
        const name = nameEl?.textContent || '闹钟';
        const enabled = !switchEl.classList.contains('off');
        alarmList.push({ time, name, enabled });
    });

    const data = loadData();
    data.alarms = alarmList;
    saveData(data);

    // 发送到 Service Worker 消息通道
    navigator.serviceWorker.ready.then(reg => {
        if (reg.active) {
            reg.active.postMessage({
                type: 'SYNC_ALARMS',
                alarms: alarmList
            });
        }
    });
}

/* ============ 页面切换 ============ */
function updateDateDisplay() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];

    const dateEl = document.getElementById('currentDate');
    const weekdayEl = document.getElementById('weekday');
    if (dateEl) dateEl.textContent = `${year}年${month}月${day}日`;
    if (weekdayEl) weekdayEl.textContent = weekday;
}

function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-btn').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageId) item.classList.add('active');
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

/* ============ 事件监听 ============ */
function initEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(item => {
        item.addEventListener('click', () => switchPage(item.dataset.page));
    });

    document.querySelectorAll('.alarm-switch').forEach(sw => {
        sw.addEventListener('click', () => {
            sw.classList.toggle('off');
            sw.textContent = sw.classList.contains('off') ? 'OFF' : 'ON';
        });
    });

    document.querySelectorAll('.mode-card').forEach(card => {
        card.addEventListener('click', () => {
            document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
        });
    });

    document.getElementById('currentDate')?.addEventListener('click', updateDateDisplay);

    // AI 对话功能
    const sendBtn = document.getElementById('sendBtn');
    const aiInput = document.getElementById('aiInput');

    sendBtn?.addEventListener('click', () => {
        const msg = aiInput?.value.trim();
        if (msg) {
            sendToAI(msg);
            aiInput.value = '';
        }
    });

    aiInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const msg = aiInput.value.trim();
            if (msg) {
                sendToAI(msg);
                aiInput.value = '';
            }
        }
    });

    // 快捷按钮
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt) sendToAI(prompt);
        });
    });

    // 添加闹钟按钮 → 打开弹窗
    const addAlarmBtn = document.getElementById('addAlarmBtn');
    addAlarmBtn?.addEventListener('click', () => openAlarmModal(null));
}

/* ============ 闹钟详情弹窗 ============ */
let currentEditingId = null;
let alarmCustomDays = [];
let alarmVibrateEnabled = false;
let alarmRepeatSelected = 'daily';
let alarmToneSelected = 'classic';
let selectedHour = 0;
let selectedMin = 0;
let selectedSec = 0;

function openAlarmModal(id) {
    currentEditingId = id;
    const overlay = document.getElementById('alarmModalOverlay');
    const modal = document.getElementById('alarmModal');
    const title = document.getElementById('modalTitle');
    const deleteBtn = document.getElementById('modalDeleteBtn');
    const nameInput = document.getElementById('modalAlarmName');

    // 重置所有选项
    alarmRepeatSelected = 'daily';
    alarmCustomDays = [];
    alarmVibrateEnabled = false;
    alarmToneSelected = 'classic';
    alarmCustomDays = [];

    if (id === null) {
        // 新增模式
        title.textContent = '添加闹钟';
        deleteBtn.style.display = 'none';
        const now = new Date();
        selectedHour = now.getHours();
        selectedMin = now.getMinutes() + 1;
        selectedSec = 0;
        nameInput.value = '';
    } else {
        // 编辑模式
        title.textContent = '编辑闹钟';
        deleteBtn.style.display = 'block';

        const data = loadData();
        const alarm = data.alarms.find(a => (a._id || a.id) === id);
        if (alarm) {
            const [h, m, s] = (alarm.time || '00:00:00').split(':');
            selectedHour = parseInt(h, 10);
            selectedMin = parseInt(m, 10);
            selectedSec = parseInt(s || '0', 10);
            nameInput.value = alarm.name || '';
            alarmRepeatSelected = alarm.repeat || 'daily';
            alarmVibrateEnabled = alarm.vibrate || false;
            alarmToneSelected = alarm.tone || 'classic';
            alarmCustomDays = alarm.customDays || [];
        } else {
            selectedHour = 0; selectedMin = 0; selectedSec = 0;
            nameInput.value = '';
        }
    }

    // 更新时间滚轮
    updateTimePickerDisplay();
    // 更新选项状态
    updateRepeatUI();
    updateVibrateUI();
    updateToneUI();

    // 显示弹窗
    overlay.style.display = 'flex';
    setTimeout(() => {
        overlay.classList.add('active');
        modal.classList.add('active');
    }, 10);
}

function closeAlarmModal() {
    const overlay = document.getElementById('alarmModalOverlay');
    const modal = document.getElementById('alarmModal');
    overlay.classList.remove('active');
    modal.classList.remove('active');
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 300);
    currentEditingId = null;
}

function updateTimePickerDisplay() {
    // 更新时间显示
    const hourEl = document.getElementById('hourScroll');
    const minEl = document.getElementById('minScroll');
    const secEl = document.getElementById('secScroll');
    if (hourEl) hourEl.querySelector('.time-scroll-inner').textContent = String(selectedHour).padStart(2, '0');
    if (minEl) minEl.querySelector('.time-scroll-inner').textContent = String(selectedMin).padStart(2, '0');
    if (secEl) secEl.querySelector('.time-scroll-inner').textContent = String(selectedSec).padStart(2, '0');
}

function updateRepeatUI() {
    document.querySelectorAll('.repeat-chip').forEach(chip => {
        chip.classList.toggle('selected', chip.dataset.repeat === alarmRepeatSelected);
    });
    const customDaysEl = document.getElementById('customDays');
    if (customDaysEl) {
        customDaysEl.style.display = alarmRepeatSelected === 'custom' ? 'flex' : 'none';
    }
    if (alarmRepeatSelected === 'custom') {
        document.querySelectorAll('.day-chip').forEach(chip => {
            chip.classList.toggle('selected', alarmCustomDays.includes(parseInt(chip.dataset.day, 10)));
        });
    }
}

function updateVibrateUI() {
    const thumb = document.getElementById('vibrateThumb');
    const status = document.getElementById('vibrateStatus');
    if (thumb) thumb.style.left = alarmVibrateEnabled ? '28px' : '2px';
    if (status) status.textContent = alarmVibrateEnabled ? '开启' : '关闭';
}

function updateToneUI() {
    document.querySelectorAll('.ringtone-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.tone === alarmToneSelected);
    });
}

function saveAlarm() {
    const nameInput = document.getElementById('modalAlarmName');
    const name = nameInput?.value.trim() || '新闹钟';
    const time = `${String(selectedHour).padStart(2, '0')}:${String(selectedMin).padStart(2, '0')}:${String(selectedSec).padStart(2, '0')}`;

    const alarmObj = {
        _id: currentEditingId || ('id_' + Date.now()),
        id: currentEditingId || ('id_' + Date.now()),
        time,
        name,
        repeat: alarmRepeatSelected,
        vibrate: alarmVibrateEnabled,
        tone: alarmToneSelected,
        enabled: true,
        customDays: alarmRepeatSelected === 'custom' ? [...alarmCustomDays] : []
    };

    const data = loadData();
    if (currentEditingId) {
        const idx = data.alarms.findIndex(a => (a._id || a.id) === currentEditingId);
        if (idx >= 0) {
            data.alarms[idx] = alarmObj;
        } else {
            data.alarms.push(alarmObj);
        }
    } else {
        data.alarms.push(alarmObj);
    }
    saveData(data);

    closeAlarmModal();
    // 刷新列表
    renderSavedAlarms();
    // 同步到 Service Worker
    syncAlarmsToServiceWorker();
}

function deleteAlarm() {
    if (!currentEditingId) return;
    if (!confirm('确定要删除这个闹钟吗？')) return;
    const data = loadData();
    data.alarms = data.alarms.filter(a => (a._id || a.id) !== currentEditingId);
    saveData(data);
    closeAlarmModal();
    renderSavedAlarms();
    syncAlarmsToServiceWorker();
}

function initAlarmModal() {
    // 构建时间滚轮
    buildTimeScroll('hourScroll', 24, 0, v => { selectedHour = v; });
    buildTimeScroll('minScroll', 60, 0, v => { selectedMin = v; });
    buildTimeScroll('secScroll', 60, 0, v => { selectedSec = v; });

    // 点击遮罩关闭
    document.getElementById('alarmModalOverlay')?.addEventListener('click', function(e) {
        if (e.target === this) closeAlarmModal();
    });

    // 关闭按钮
    document.getElementById('modalCloseBtn')?.addEventListener('click', closeAlarmModal);

    // 删除按钮
    document.getElementById('modalDeleteBtn')?.addEventListener('click', deleteAlarm);

    // 保存按钮
    document.getElementById('modalSaveBtn')?.addEventListener('click', saveAlarm);

    // 重复选项
    document.querySelectorAll('.repeat-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            alarmRepeatSelected = chip.dataset.repeat;
            if (alarmRepeatSelected !== 'custom') alarmCustomDays = [];
            updateRepeatUI();
        });
    });

    // 自定义星期
    document.querySelectorAll('.day-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const day = parseInt(chip.dataset.day, 10);
            if (alarmCustomDays.includes(day)) {
                alarmCustomDays = alarmCustomDays.filter(d => d !== day);
            } else {
                alarmCustomDays.push(day);
                alarmCustomDays.sort();
            }
            updateRepeatUI();
        });
    });

    // 震动开关
    document.getElementById('vibrateToggle')?.addEventListener('click', () => {
        alarmVibrateEnabled = !alarmVibrateEnabled;
        updateVibrateUI();
        if (alarmVibrateEnabled && navigator.vibrate) {
            navigator.vibrate(100);
        }
    });

    // 铃声选项
    document.querySelectorAll('.ringtone-item').forEach(item => {
        item.addEventListener('click', () => {
            alarmToneSelected = item.dataset.tone;
            updateToneUI();
            playAlarmSound(alarmToneSelected);
        });
    });

    // 滚轮上下按钮（每列时间滚轮）
    setupTimeScrollButtons('hourScroll', 24, v => { selectedHour = v; });
    setupTimeScrollButtons('minScroll', 60, v => { selectedMin = v; });
    setupTimeScrollButtons('secScroll', 60, v => { selectedSec = v; });
}

function buildTimeScroll(id, max, initial, onChange) {
    const el = document.getElementById(id);
    if (!el) return;

    // 上下箭头按钮
    const upBtn = document.createElement('button');
    upBtn.className = 'scroll-btn scroll-up';
    upBtn.textContent = '▲';
    upBtn.addEventListener('click', () => {
        if (id === 'hourScroll') { selectedHour = (selectedHour + 1) % 24; onChange(selectedHour); }
        else if (id === 'minScroll') { selectedMin = (selectedMin + 1) % 60; onChange(selectedMin); }
        else { selectedSec = (selectedSec + 1) % 60; onChange(selectedSec); }
        updateTimePickerDisplay();
    });

    const downBtn = document.createElement('button');
    downBtn.className = 'scroll-btn scroll-down';
    downBtn.textContent = '▼';
    downBtn.addEventListener('click', () => {
        if (id === 'hourScroll') { selectedHour = (selectedHour - 1 + 24) % 24; onChange(selectedHour); }
        else if (id === 'minScroll') { selectedMin = (selectedMin - 1 + 60) % 60; onChange(selectedMin); }
        else { selectedSec = (selectedSec - 1 + 60) % 60; onChange(selectedSec); }
        updateTimePickerDisplay();
    });

    el.appendChild(upBtn);
    el.appendChild(downBtn);

    // 中间显示
    const inner = el.querySelector('.time-scroll-inner') || (() => {
        const d = document.createElement('div');
        d.className = 'time-scroll-inner';
        el.insertBefore(d, upBtn);
        return d;
    })();
    inner.textContent = String(initial).padStart(2, '0');
}

function setupTimeScrollButtons(id, max, onChange) {
    // 已在 buildTimeScroll 中处理
}

/* ============ 初始化 ============ */
document.addEventListener('DOMContentLoaded', () => {
    initIntro();
    initEventListeners();
    initCloudSyncEventListeners();
    initAlarmModal();
    updateDateDisplay();
    updateClockDisplay();
    requestNotificationPermission();
    renderSavedAlarms();
    registerServiceWorker();
    initCloudSync();

    // 每秒更新时间显示
    setInterval(updateClockDisplay, 1000);
    // 每秒检查闹钟
    setInterval(checkAlarms, 1000);
    // 每 5 分钟同步一次闹钟到 Service Worker
    setInterval(syncAlarmsToServiceWorker, 5 * 60 * 1000);
});

/* ============ 云同步模块（跨设备同步闹钟与数据） ============ */

// 默认 Firebase 配置（演示用，推荐你自己的替换为你自己的 Firebase 项目
const DEFAULT_FIREBASE_CONFIG = {
    apiKey: "AIzaSyD4kF_5154321567897654321",
    authDomain: "zhilv-demo.firebaseapp.com",
    databaseURL: "https://zhilv-demo-default-rtdb.firebaseio.com",
    projectId: "zhilv-demo",
    storageBucket: "zhilv-demo.appspot.com",
    messagingSenderId: "417770321",
    appId: "1:417770321:web:demo1234567890"
};

// 云同步状态
let cloudSyncKey = null;
let firebaseApp = null;
let firebaseDb = null;
let lastLocalUpdate = 0;
let syncingFromCloud = false;

// 加载用户的 Firebase 配置（如果没有则使用默认配置）
function getFirebaseConfig() {
    try {
        const saved = localStorage.getItem('zhilv_firebase_config');
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return DEFAULT_FIREBASE_CONFIG;
}

// 保存用户自定义 Firebase 配置
function saveFirebaseConfig(config) {
    localStorage.setItem('zhilv_firebase_config', JSON.stringify(config));
}

// 初始化 Firebase
function initFirebase() {
    if (firebaseApp) return firebaseApp;
    if (typeof firebase === 'undefined') {
        console.log('⚠️ Firebase SDK 未加载');
        setSyncStatus('⚠️ Firebase 加载失败，请检查网络');
        return null;
    }
    try {
        const config = getFirebaseConfig();
        if (!config || !config.apiKey || config.apiKey.indexOf('demo') > -1 || !config.databaseURL) {
            console.log('⚠️ Firebase: 未配置有效的 Firebase 配置');
            setSyncStatus('⚠️ 未配置 Firebase，仅本地模式');
            return null;
        }
        if (firebase.apps.length > 0) {
            firebaseApp = firebase.apps[0];
        } else {
            firebaseApp = firebase.initializeApp(config);
        }
        firebaseDb = firebaseApp.database();
        console.log('✅ Firebase 初始化成功');
        return firebaseApp;
    } catch (e) {
        console.log('❌ Firebase 初始化失败', e);
        setSyncStatus('❌ Firebase 连接失败: ' + (e.message || e));
        return null;
    }
}

// 更新同步状态显示
function setSyncStatus(text) {
    const statusEl = document.getElementById('cloudSyncStatus');
    if (statusEl) statusEl.textContent = text;
}

// 获取同步密钥
function getSyncKey() {
    return localStorage.getItem('zhilv_sync_key') || '';
}

// 设置同步密钥
function setSyncKey(key) {
    if (!key || key.trim() === '') {
        alert('请输入同步密钥（任意字符串，如：你的名字+幸运数字');
        return;
    }
    localStorage.setItem('zhilv_sync_key', key.trim());
    cloudSyncKey = key.trim();
    console.log('🔑 同步密钥已设置: ' + cloudSyncKey);
    alert('✅ 同步密钥已设置！现在可以上传/下载数据了。\n\n在其他设备上输入相同的密钥即可同步。');
    setSyncStatus('🔑 已设置密钥: ' + cloudSyncKey);

    // 自动从云端拉取一次
    downloadFromCloud();
}

// 导出数据（手动备份）
function exportData() {
    const data = loadData();
    data._exportTime = new Date().toISOString();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zhilv-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(url);
    alert('✅ 数据已导出到下载文件夹！');
}

// 导入数据（从文件恢复）
function importData(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object') throw new Error('数据格式错误');
            saveData(data);
            renderSavedAlarms();
            alert('✅ 数据已成功导入！页面将刷新以应用新数据。');
            setTimeout(() => location.reload(), 500);
        } catch (err) {
            alert('❌ 导入失败: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// 上传数据到云端（Firebase Realtime Database）
function uploadToCloud() {
    if (!cloudSyncKey) {
        alert('⚠️ 请先设置同步密钥！');
        return;
    }

    initFirebase();
    if (!firebaseDb) {
        alert('❌ Firebase 未初始化');
        return;
    }

    const data = loadData();
    data._syncTime = Date.now();

    setSyncStatus('⬆️ 正在上传到云端...');

    try {
        const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
        firebaseDb.ref(path).set(data)
            .then(() => {
                console.log('✅ 数据已上传到云端');
                setSyncStatus('✅ 已同步到云端 · ' + new Date().toLocaleTimeString());
                alert('✅ 数据已成功上传到云端！\n其他设备使用相同密钥即可同步此数据。');
                lastLocalUpdate = Date.now();
            })
            .catch(err => {
                console.error('❌ 上传失败', err);
                setSyncStatus('❌ 上传失败: ' + (err.message || err));
                alert('❌ 上传失败: ' + (err.message || err) + '\n\n建议：配置你自己的 Firebase 项目');
            });
    } catch (e) {
        console.error('❌ 上传异常', e);
        alert('❌ 上传异常: ' + (e.message || e));
    }
}

// 从云端下载数据
function downloadFromCloud() {
    if (!cloudSyncKey) {
        alert('⚠️ 请先设置同步密钥！');
        return;
    }

    initFirebase();
    if (!firebaseDb) {
        alert('❌ Firebase 未初始化，请先配置 Firebase');
        return;
    }

    setSyncStatus('⬇️ 正在从云端下载...');

    try {
        const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
        firebaseDb.ref(path).once('value')
            .then(snapshot => {
                const data = snapshot.val();
                if (!data) {
                    setSyncStatus('⚠️ 云端暂无数据（密钥: ' + cloudSyncKey);
                    alert('⚠️ 云端暂无数据（密钥: ' + cloudSyncKey + ')\n请先在其他设备上上传数据。');
                    return;
                }

                syncingFromCloud = true;
                saveData(data);
                renderSavedAlarms();
                syncingFromCloud = false;
                setSyncStatus('✅ 已从云端同步 · ' + new Date().toLocaleTimeString());
                alert('✅ 数据已从云端下载成功！页面将刷新以应用新数据。');
                setTimeout(() => location.reload(), 500);
            })
            .catch(err => {
                console.error('❌ 下载失败', err);
                setSyncStatus('❌ 下载失败: ' + (err.message || err));
                alert('❌ 下载失败: ' + (err.message || err) + '\n\n建议：配置你自己的 Firebase 项目');
            });
    } catch (e) {
        console.error('❌ 下载异常', e);
        alert('❌ 下载异常: ' + (e.message || e));
    }
}

// 实时监听云端数据变化（实时同步
let cloudListenerCallback = null;
let cloudListenerRef = null;
function startCloudListener() {
    if (!cloudSyncKey || !firebaseDb) return;

    // 移除旧的监听器
    if (cloudListenerRef && cloudListenerCallback) {
        try { cloudListenerRef.off('value', cloudListenerCallback); } catch(e) {}
    }

    try {
        const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
        cloudListenerRef = firebaseDb.ref(path);
        cloudListenerCallback = function(snapshot) {
            const data = snapshot.val();
            if (!data || !data._syncTime) return;

            // 防止循环更新
            if (syncingFromCloud) return;
            if (data._syncTime <= lastLocalUpdate) return;

            console.log('🔄 检测到云端数据更新，时间:', data._syncTime);
            syncingFromCloud = true;
            saveData(data);
            renderSavedAlarms();
            syncingFromCloud = false;
            setSyncStatus('🔄 实时同步中 · ' + new Date().toLocaleTimeString());
        };
        cloudListenerRef.on('value', cloudListenerCallback);
    } catch (e) {
        console.error('❌ 实时监听失败', e);
    }
}

// 初始化云同步功能（在页面加载时调用
function initCloudSync() {
    const savedKey = getSyncKey();
    if (savedKey) {
        cloudSyncKey = savedKey;
        setSyncStatus('🔑 已连接密钥: ' + cloudSyncKey);
        initFirebase();
        if (firebaseDb) {
            startCloudListener();
        }
    }
}

// 更新 saveData，增加云端自动上传
const originalSaveData = saveData;
saveData = function(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    lastLocalUpdate = Date.now();
    // 如果有云同步密钥，自动上传到云端
    if (cloudSyncKey && firebaseDb) {
        try {
            const toUpload = JSON.parse(JSON.stringify(data));
            toUpload._syncTime = lastLocalUpdate;
            const path = '/zhilv/' + btoa(unescape(encodeURIComponent(cloudSyncKey)));
            firebaseDb.ref(path).set(toUpload).catch(err => {
                console.log('自动上传到云端失败', err);
            });
        } catch (e) {
            console.log('自动上传到云端异常', e);
        }
    }
};

/* ============ 云同步按钮事件绑定 ============ */
function initCloudSyncEventListeners() {
    // 设置同步密钥
    const setKeyBtn = document.getElementById('setSyncKeyBtn');
    const keyInput = document.getElementById('syncKeyInput');
    setKeyBtn?.addEventListener('click', () => {
        const val = keyInput?.value.trim();
        setSyncKey(val);
    });
    keyInput?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            setSyncKey(keyInput.value.trim());
        }
    });
    // 如果已有密钥，显示在输入框
    if (keyInput) keyInput.value = getSyncKey();

    // 导出数据
    document.getElementById('exportDataBtn')?.addEventListener('click', exportData);

    // 导入数据
    const importBtn = document.getElementById('importDataBtn');
    const importFile = document.getElementById('importFileInput');
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importData(file);
        e.target.value = '';
    });

    // 上传到云端
    document.getElementById('uploadCloudBtn')?.addEventListener('click', uploadToCloud);

    // 从云端下载
    document.getElementById('downloadCloudBtn')?.addEventListener('click', downloadFromCloud);

    // 保存 Firebase 配置
    document.getElementById('saveFirebaseBtn')?.addEventListener('click', () => {
        const input = document.getElementById('firebaseConfigInput');
        if (!input) return;
        try {
            const config = JSON.parse(input.value.trim());
            if (!config.apiKey || !config.databaseURL) {
                alert('❌ Firebase 配置必须包含 apiKey 和 databaseURL');
                return;
            }
            saveFirebaseConfig(config);
            alert('✅ Firebase 配置已保存！页面将刷新以应用新配置。');
            setTimeout(() => location.reload(), 500);
        } catch (e) {
            alert('❌ 配置格式错误，请粘贴完整的 JSON 配置');
        }
    });

    // 如果已有 Firebase 配置，显示在输入框
    const fbInput = document.getElementById('firebaseConfigInput');
    if (fbInput) {
        const saved = getFirebaseConfig();
        if (saved && saved.apiKey && saved.apiKey.indexOf('demo') === -1) {
            fbInput.value = JSON.stringify(saved, null, 2);
        }
    }
}

/* ============ 初始化 ============ */
document.addEventListener('DOMContentLoaded', () => {
    initIntro();
    initEventListeners();
    initCloudSyncEventListeners();
    updateDateDisplay();
    requestNotificationPermission();
    renderSavedAlarms();
    registerServiceWorker();
    initCloudSync();

    // 每分钟检查闹钟
    setInterval(checkAlarms, 60000);
    // 每 5 分钟同步一次闹钟到 Service Worker
    setInterval(syncAlarmsToServiceWorker, 5 * 60 * 1000);
});
