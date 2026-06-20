import fs from 'fs';
const src = fs.readFileSync('script.js', 'utf-8');

// 1. 提取 periodOfHour 函数
console.log('=== periodOfHour function ===');
const m = src.match(/function periodOfHour[\s\S]*?\n\}/);
console.log(m ? m[0] : 'NOT FOUND');

// 2. 提取开关 DOM 模板
console.log('\n=== 开关 DOM 模板 ===');
const switchBlock = src.match(/<div class="alarm-card-switch[^>]*>[\s\S]*?<\/div>/);
console.log(switchBlock ? switchBlock[0] : 'NOT FOUND');

// 3. 检查 alarm-card-period 的 DOM 模板
console.log('\n=== 时间段显示 DOM 模板 ===');
const periodLine = src.match(/alarm-card-period[^<]*<\/span>/);
console.log(periodLine ? periodLine[0] : 'NOT FOUND');

// 4. 提取 repeatLabel 函数
console.log('\n=== repeatLabel function ===');
const rep = src.match(/function repeatLabel[\s\S]*?\n\}/);
console.log(rep ? rep[0] : 'NOT FOUND');

// 5. 检查 alarm-subnav 和 alarm-panel 结构
console.log('\n=== 检查 alarm-subnav 按钮是否有 data-sub 属性 ===');
console.log('index.html 中有 alarm-subnav 按钮');

// 6. 检查事件委托
console.log('\n=== 事件委托代码 (initAlarmListEventDelegation) ===');
const deleg = src.match(/function initAlarmListEventDelegation[\s\S]*?\n\}/);
console.log(deleg ? deleg[0] : 'NOT FOUND');

console.log('\nDone.');
