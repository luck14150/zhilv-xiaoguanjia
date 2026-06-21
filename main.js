const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
    const iconPath = path.join(__dirname, 'icon.png');
    const fs = require('fs');
    const hasIcon = fs.existsSync(iconPath);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 360,
        minHeight: 600,
        title: '智律小管家',
        backgroundColor: '#1a1a2e',
        icon: hasIcon ? iconPath : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true
        }
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

function createMenu() {
    const template = [
        {
            label: '文件',
            submenu: [
                {
                    label: '刷新',
                    accelerator: 'F5',
                    click: () => {
                        if (mainWindow) mainWindow.webContents.reload();
                    }
                },
                { type: 'separator' },
                {
                    label: '退出',
                    accelerator: 'Ctrl+Q',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: '视图',
            submenu: [
                {
                    label: '放大',
                    accelerator: 'Ctrl++',
                    click: () => {
                        if (mainWindow) {
                            const current = mainWindow.webContents.getZoomLevel();
                            mainWindow.webContents.setZoomLevel(current + 0.5);
                        }
                    }
                },
                {
                    label: '缩小',
                    accelerator: 'Ctrl+-',
                    click: () => {
                        if (mainWindow) {
                            const current = mainWindow.webContents.getZoomLevel();
                            mainWindow.webContents.setZoomLevel(current - 0.5);
                        }
                    }
                },
                {
                    label: '重置缩放',
                    accelerator: 'Ctrl+0',
                    click: () => {
                        if (mainWindow) mainWindow.webContents.setZoomLevel(0);
                    }
                },
                { type: 'separator' },
                {
                    label: '开发者工具',
                    accelerator: 'Ctrl+Shift+I',
                    click: () => {
                        if (mainWindow) mainWindow.webContents.toggleDevTools();
                    }
                }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '关于智律小管家',
                    click: () => {
                        const aboutWindow = new BrowserWindow({
                            width: 400,
                            height: 300,
                            title: '关于',
                            resizable: false,
                            minimizable: false,
                            maximizable: false,
                            parent: mainWindow,
                            modal: true
                        });
                        aboutWindow.setMenuBarVisibility(false);
                        aboutWindow.loadFile('about.html');
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    createWindow();
    createMenu();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('get-app-version', (event) => {
    event.returnValue = app.getVersion();
});
