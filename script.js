/* ============ 智律小管家 ============ */

// 更新日期显示
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

// 切换页面
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

// 开场动画完成后自动进入首页
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

// 初始化事件监听
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
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initIntro();
    initEventListeners();
    updateDateDisplay();
});
