// 直接在 Node 中模拟渲染，看看实际生成的 HTML 结构
const fs = require('fs');
const src = fs.readFileSync('script.js', 'utf-8');

// 提取 periodOfHour 的实际代码
console.log('=== periodOfHour function ===');
const m = src.match(/function periodOfHour[\s\S]*?\n\}/);
console.log(m ? m[0] : 'NOT FOUND');

// 提取 renderSavedAlarms 中 period 的部分
console.log('\n=== periodOfHour 调用点 ===');
const callM = src.match(/periodOfHour\(.*?\)/g);
console.log(callM);

// 检查 alarm-card-period 字符串模板
console.log('\n=== 包含 period 的卡片字符串模板 ===');
const line = src.match(/alarm-card-period.*?\+.*?\+/);
console.log(line ? line[0] : 'NOT FOUND');

// 检查 alarm-card-switch 的结构
console.log('\n=== 开关 DOM 模板 ===');
const sw = src.match(/alarm-card-switch[^'"]*['"]([^'"]+)['"][\s\S]*?alarm-card-switch-thumb[\s\S]*?alarm-card-switch['"]/);
console.log(sw ? sw[0] : 'NOT FOUND');
