// Try different ways to get electron
console.log('Testing electron access methods:');

// Method 1: Standard require
try {
  const e1 = require('electron');
  console.log('1. require("electron"):', typeof e1, e1?.app ? 'HAS APP' : 'NO APP');
} catch(e) {
  console.log('1. require("electron") failed:', e.message);
}

// Method 2: Check process.versions.electron
console.log('2. process.versions.electron:', process.versions.electron);

// Method 3: Check if we're in main process
console.log('3. process.type:', process.type);

// Method 4: Try require.main
console.log('4. require.main:', require.main?.filename);

// Method 5: Check module paths
console.log('5. module.paths (first 3):', module.paths.slice(0, 3));

process.exit(0);
