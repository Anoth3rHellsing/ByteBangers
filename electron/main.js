const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ByteBangers — 16-Bit Retro Wave DAW',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#0d0221',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Build application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Song',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.send('menu-action', 'new-song');
          },
        },
        {
          label: 'Export WAV...',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            mainWindow.webContents.send('menu-action', 'export-wav');
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'Transport',
      submenu: [
        {
          label: 'Play / Stop',
          accelerator: 'Space',
          click: () => {
            mainWindow.webContents.send('menu-action', 'toggle-play');
          },
        },
        {
          label: 'Stop',
          accelerator: 'CmdOrCtrl+.',
          click: () => {
            mainWindow.webContents.send('menu-action', 'stop');
          },
        },
        {
          label: 'Clear Pattern',
          accelerator: 'CmdOrCtrl+Delete',
          click: () => {
            mainWindow.webContents.send('menu-action', 'clear');
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ByteBangers',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About ByteBangers',
              message: 'ByteBangers v1.0.0',
              detail: '16-Bit Retro Wave Music Studio\n\nA browser-based chiptune/16-bit music creation tool with authentic SNES/Genesis-era synthesis.\n\nBuilt with Web Audio API + Electron.\nUI: Retro Wave Design System.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});