/**
 * CheckCommand module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported doCheck, maybeCancel, isChecking */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { RootMode, Convenience } = Me.imports.lib;
const Gio = imports.gi.Gio;
const logDebug = Convenience.logDebug;

let checkCancel = null;

/**
 * Wait for checkCmd to execute successfully.
 *
 * @param {string} checkCmd check command
 * @param {(line: string) => void} onLog
 * @param {async () => void} redoRootProtection
 */
async function doCheck(checkCmd, onLog, redoRootProtection) {
  if (checkCancel !== null) {
    throw new Error(
      'Confirmation canceled: attempted to start a second check command!'
    );
  }
  const continueRootProtection = async () => {
    if (isChecking())
      try {
        await RootMode.execCheck(['sleep', '30'], checkCancel, false);
        await redoRootProtection();
        logDebug('[continueRootProtectionDuringCheck] Continue');
        await continueRootProtection();
        return;
      } catch (err) {}
    logDebug('[continueRootProtectionDuringCheck] Done');
  };
  const check = async () => {
    logDebug('[doCheck] start');
    try {
      await RootMode.execCheck(checkCmd, checkCancel, true, onLog);
      logDebug('[doCheck] confirmed');
    } finally {
      if (isChecking()) checkCancel.cancel();
      checkCancel = null;
    }
  };
  checkCancel = new Gio.Cancellable();
  await Promise.all([check(), continueRootProtection()]);
}

function isChecking() {
  return checkCancel !== null && !checkCancel.is_cancelled();
}

function maybeCancel() {
  const doCancel = isChecking();
  if (doCancel) {
    checkCancel.cancel();
  }
  checkCancel = null;
  return doCancel;
}
