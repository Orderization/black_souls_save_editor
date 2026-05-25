const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { parseRgss3aArchive, extractSelectedDataFiles } = require('./src/rgss3a');
const { RubyRvdata2Bridge } = require('./src/rubyBridge');

let mainWindow;
let loadedArchive = null;
let extractedDbDir = null;
let rubyBridge = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1000,
    minHeight: 650,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function getBridge() {
  if (!rubyBridge) rubyBridge = new RubyRvdata2Bridge(path.join(__dirname, 'ruby', 'rvdata2_bridge.rb'));
  return rubyBridge;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('dialog:selectArchive', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game.rgss3a',
    filters: [{ name: 'RPG Maker VX Ace Archive', extensions: ['rgss3a'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectSave', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Save*.rvdata2',
    filters: [{ name: 'RPG Maker VX Ace Data', extensions: ['rvdata2'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('archive:load', async (_event, archivePath) => {
  loadedArchive = parseRgss3aArchive(archivePath);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-vxace-db-'));
  extractedDbDir = path.join(tempRoot, 'Data');
  fs.mkdirSync(extractedDbDir, { recursive: true });

  const wanted = [
    'Data/System.rvdata2',
    'Data/Actors.rvdata2',
    'Data/Items.rvdata2',
    'Data/Weapons.rvdata2',
    'Data/Armors.rvdata2'
  ];
  const extracted = extractSelectedDataFiles(loadedArchive, wanted, extractedDbDir);

  const db = await getBridge().database(extractedDbDir);

  return {
    archivePath,
    version: loadedArchive.version,
    fileCount: loadedArchive.entries.length,
    dataFileCount: loadedArchive.entries.filter(e => e.normalizedName.toLowerCase().startsWith('data/')).length,
    extracted,
    db
  };
});

ipcMain.handle('save:load', async (_event, savePath) => {
  // Load saves independently. Game.rgss3a is optional metadata used only by
  // the renderer to decorate IDs with names. This keeps Save*.rvdata2 editable
  // even when no archive has been loaded.
  return await getBridge().summary(savePath, null);
});

ipcMain.handle('save:write', async (_event, savePath, patch) => {
  return await getBridge().apply(savePath, patch);
});

ipcMain.handle('open:path', async (_event, targetPath) => {
  if (!targetPath) return false;
  await shell.showItemInFolder(targetPath);
  return true;
});
