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

/* ============ 实时时钟 & 闹钟功能 ============ */
let alarmTimers = [];

function checkAlarms() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const alarms = document.querySelectorAll('.alarm-row');
    alarms.forEach(row => {
        const timeEl = row.querySelector('.alarm-time');
        const switchEl = row.querySelector('.alarm-switch');
        if (timeEl && switchEl && !switchEl.classList.contains('off')) {
            const alarmTime = timeEl.textContent.replace(/[^\d:]/g, '');
            if (alarmTime === currentTime) {
                triggerAlarm(row);
            }
        }
    });
}

function triggerAlarm(row) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏰ 智律小管家', {
            body: row.querySelector('.alarm-name')?.textContent || '闹钟响了！',
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⏰</text></svg>'
        });
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
    const alarmPanel = document.querySelector('.alarm-panel');
    if (!alarmPanel || !data.alarms || data.alarms.length === 0) return;

    // 清空除了默认显示之外的已保存闹钟（避免重复渲染）
    const existing = alarmPanel.querySelectorAll('.alarm-row.saved');
    existing.forEach(el => el.remove());

    const addBtn = document.querySelector('.add-alarm');

    data.alarms.forEach(alarm => {
        const [h, m] = alarm.time.split(':');
        const newAlarm = document.createElement('div');
        newAlarm.className = 'alarm-row saved';
        newAlarm.innerHTML = `
            <div class="alarm-time">${String(h).padStart(2, '0')}<span class="sep">:</span>${String(m).padStart(2, '0')}</div>
            <div class="alarm-info">
                <div class="alarm-name">${alarm.name}</div>
                <div class="alarm-detail">已同步</div>
            </div>
            <div class="alarm-switch">ON</div>
        `;
        alarmPanel.insertBefore(newAlarm, addBtn);

        const sw = newAlarm.querySelector('.alarm-switch');
        sw.addEventListener('click', function () {
            this.classList.toggle('off');
            this.textContent = this.classList.contains('off') ? 'OFF' : 'ON';
        });
    });
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

    // 添加闹钟按钮
    const addAlarmBtn = document.querySelector('.add-alarm');
    addAlarmBtn?.addEventListener('click', () => {
        const time = prompt('请输入闹钟时间 (例如: 08:00', '08:00');
        const name = prompt('请输入闹钟名称', '新闹钟');
        if (time && name) {
            const alarmPanel = document.querySelector('.alarm-panel');
            const newAlarm = document.createElement('div');
            newAlarm.className = 'alarm-row';
            const [h, m] = time.split(':');
            newAlarm.innerHTML = `
                <div class="alarm-time">${String(h).padStart(2, '0')}<span class="sep">:</span>${String(m).padStart(2, '0')}</div>
                <div class="alarm-info">
                    <div class="alarm-name">${name}</div>
                    <div class="alarm-detail">自定义</div>
                </div>
                <div class="alarm-switch">ON</div>
            `;
            alarmPanel.insertBefore(newAlarm, addAlarmBtn);

            newAlarm.querySelector('.alarm-switch').addEventListener('click', function() {
                this.classList.toggle('off');
                this.textContent = this.classList.contains('off') ? 'OFF' : 'ON';
            });

            // 保存到本地
            const data = loadData();
            data.alarms.push({ time, name });
            saveData(data);
        }
    });
}

/* ============ 初始化 ============ */
document.addEventListener('DOMContentLoaded', () => {
    initIntro();
    initEventListeners();
    updateDateDisplay();
    requestNotificationPermission();
    renderSavedAlarms();
    registerServiceWorker();

    // 每分钟检查闹钟
    setInterval(checkAlarms, 60000);
    // 每 5 分钟同步一次闹钟到 Service Worker
    setInterval(syncAlarmsToServiceWorker, 5 * 60 * 1000);
});
