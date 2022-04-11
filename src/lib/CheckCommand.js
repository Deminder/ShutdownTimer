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

let checkCancel;

/**
 * Wait for checkCmd to execute successfully.
 * @param {string} checkCmd check command
 * @param {string} mode shutdown mode
 * @param {() => void} onStart
 * @param {(line: string) => void} onLog
 * @param {(code: string) => void} onAbort
 * @param {async () => void} redoRootProtection
 */
function doCheck(checkCmd, onLog, redoRootProtection) {
  if (checkCancel !== undefined) {
    return Promise.reject(
      new Error(
        'Confirmation canceled: attempted to start a second check command!'
      )
    );
  }

  checkCancel = new Gio.Cancellable();
  const checkWatchCancel = new Gio.Cancellable();
  return Promise.all([
    _doCheck(checkCmd, checkWatchCancel, onLog),
    continueRootProtectionDuringCheck(checkWatchCancel, redoRootProtection),
  ]);
}
async function _doCheck(checkCmd, checkWatchCancel, onLog) {
  try {
    await RootMode.execCheck(checkCmd, checkCancel, true, onLog);
    logDebug(`Check command "${checkCmd}" confirmed shutdown.`);
  } finally {
    checkCancel = undefined;
    checkWatchCancel.cancel();
  }
}

async function continueRootProtectionDuringCheck(
  cancellable,
  redoRootProtection
) {
  try {
    await RootMode.execCheck(['sleep', '30'], cancellable, false);
  } catch (err) {
    logDebug('RootProtection during check: Canceled');
  }
  if (checkCancel === undefined) {
    logDebug('RootProtection during check: Done');
  } else {
    await redoRootProtection();
    logDebug('RootProtection during check: Continue');
    await continueRootProtectionDuringCheck(cancellable, redoRootProtection);
  }
}

function isChecking() {
  return checkCancel !== undefined && !checkCancel.is_cancelled();
}

function maybeCancel() {
  const doCancel = isChecking();
  if (doCancel) {
    checkCancel.cancel();
  }
  return doCancel;
}
