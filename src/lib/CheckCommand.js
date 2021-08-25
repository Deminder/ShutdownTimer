/**
 * CheckCommand module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported maybeDoCheck, maybeCancel, isChecking */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { RootMode, Convenience } = Me.imports.lib;
const Gio = imports.gi.Gio;
const logDebug = Convenience.logDebug;

let checkCancel, checkSuccess;

/**
 * Wait for checkCmd to execute successfully.
 * @param {string} checkCmd check command
 * @param {string} mode shutdown mode
 * @param {() => void} onStart
 * @param {(code: string) => void} onAbort
 * @param {() => void} onStop
 * @param {(done: boolean, success: boolean) => Promise<void>} onSuccessIdle
 */
function maybeDoCheck(checkCmd, mode, onStart, onAbort, onStop, onSuccessIdle) {
  if (checkCancel !== undefined) {
    throw new Error(
      'Confirmation canceled: attempted to start a second check command!'
    );
  }

  if (checkCmd === '') {
    return Promise.resolve();
  }

  checkCancel = new Gio.Cancellable();
  onStart();
  checkSuccess = false;
  const checkWatchCancel = new Gio.Cancellable();
  continueRootProtectionDuringCheck(mode, checkWatchCancel, onSuccessIdle);
  return RootMode.execCheck(checkCmd, checkCancel)
    .then(() => {
      checkSuccess = true;
      logDebug(`Check command "${checkCmd}" confirmed shutdown.`);
      return;
    })
    .catch(err => {
      let code = '?';
      if ('code' in err) {
        code = `${err.code}`;
        logDebug(`Check command aborted ${mode}. Code: ${code}`);
      }
      onAbort(code);
      throw err;
    })
    .finally(() => {
      checkCancel = undefined;
      checkWatchCancel.cancel();
      onStop();
    });
}

async function continueRootProtectionDuringCheck(
  mode,
  cancellable,
  onSuccessIdle
) {
  await RootMode.execCheck(['sleep', '30'], cancellable, false).catch(() => {});
  const done = checkCancel === undefined;
  await onSuccessIdle(done, checkSuccess);

  if (done) {
    logDebug('RootProtection during check: Done');
  } else {
    logDebug('RootProtection during check: Continue');
    await continueRootProtectionDuringCheck(mode, cancellable);
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
