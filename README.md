# 智律小管家 - Smart Life Manager

一款智能生活管理助手应用，帮助用户管理日常作息、计划与个人目标。

## 🎯 功能特性

- 📅 **作息管理** - 科学规划每日计划，日历视图一目了然
- ✅ **任务追踪** - 记录每日完成事项，追踪完成情况
- 📊 **数据统计** - 饼图与折线图可视化，直观了解数据趋势
- 💯 **自我评分** - 自定义评分标准，监督自我成长
- 🌈 **精美界面** - 紫蓝渐变主题，流畅的动画体验

## 📱 使用方式

### 方式一：网页版（推荐快速体验）

直接在浏览器中打开 `index.html` 即可使用。

```bash
# 使用本地服务器（推荐）
python -m http.server 8080
# 然后访问 http://localhost:8080
```

### 方式二：桌面应用程序（Windows）

将智律小管家打包为独立的桌面应用，无需浏览器即可运行。

#### 环境要求

- Node.js v18 或更高版本
- npm v8 或更高版本
- Windows 10/11 (64位)

#### 构建步骤

```bash
# 1. 进入项目目录
cd zhilv-xiaoguanjia

# 2. 安装依赖（首次运行需要几分钟下载 Electron）
npm install

# 3. 本地预览应用（不打包，直接运行）
npm start

# 4. 构建 Windows 安装包（生成 exe 文件）
npm run build-win

# 5. 构建 Windows 便携版（免安装）
npm run build-portable
```

构建完成后，安装包位于 `dist/` 目录：
- `智律小管家-1.0.0-x64.exe` - NSIS 安装程序
- `智律小管家-1.0.0-x64.7z` - 便携版压缩包

### 方式三：下载页面

打开 `download.html` 查看下载中心页面，包含完整的下载引导和安装说明。

## 🚀 技术栈

### 网页前端
- HTML5
- CSS3 (玻璃态设计 / 渐变主题)
- JavaScript (ES6+)
- Service Worker (缓存管理)

### 桌面应用
- **Electron** - 跨平台桌面应用框架
- **electron-builder** - 打包与发布工具
- 支持 Windows 10/11 (64位)

## 📁 项目结构

```
zhilv-xiaoguanjia/
├── index.html          # 应用主页面
├── download.html       # 下载中心页面
├── about.html          # 关于页面（桌面应用专用）
├── style.css           # 样式文件
├── script.js           # 主逻辑脚本
├── sw.js               # Service Worker
├── manifest.json       # PWA 清单
├── package.json        # npm 配置与依赖
├── main.js             # Electron 主进程
├── preload.js          # Electron 预加载脚本
├── clear-cache.html    # 缓存清理工具
├── dist/               # 构建输出目录（构建后生成）
└── node_modules/       # 依赖包（安装后生成）
```

## 🖥️ 桌面应用菜单

- **文件 → 刷新** - 重新加载应用
- **文件 → 退出** - 关闭应用
- **视图 → 放大/缩小/重置** - 调整窗口缩放
- **视图 → 开发者工具** - 调试窗口
- **帮助 → 关于** - 查看版本信息

## 📄 许可证

MIT License

Copyright © 2025 智律小管家
