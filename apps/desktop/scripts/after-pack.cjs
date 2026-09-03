/* eslint-disable */
const { execSync } = require("node:child_process");
const path = require("node:path");

/**
 * electron-builder afterPack hook.
 * Strips macOS extended attributes (FinderInfo, com.apple.provenance, quarantine)
 * before codesign runs, preventing 'resource fork, Finder information, or similar detritus not allowed'.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    console.log(`[afterPack] Stripping extended attributes from ${appPath}...`);
    try {
      execSync(`xattr -cr "${appPath}"`);
      execSync(`xattr -cr "${context.appOutDir}"`);
    } catch (err) {
      console.warn(`[afterPack] Note: xattr cleanup warning: ${err.message}`);
    }
  }
};
