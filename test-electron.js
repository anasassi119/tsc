const electron = require('electron');
console.log('electron type:', typeof electron);
console.log('electron keys:', Object.keys(electron).slice(0, 20));
console.log('electron.app:', electron.app);
if (electron.app) {
  electron.app.whenReady().then(() => {
    console.log('App ready!');
    electron.app.quit();
  });
} else {
  console.log('ERROR: electron.app is undefined!');
  process.exit(1);
}
