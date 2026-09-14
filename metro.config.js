// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// expo-sqlite's web build loads SQLite as WebAssembly, which Metro treats as an
// asset rather than a module. Without this, `expo export --platform all` fails
// to resolve wa-sqlite.wasm. Appended to Expo's defaults so every other asset
// type keeps resolving.
config.resolver.assetExts.push('wasm');

module.exports = config;
