// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported installAction, checkInstalled, reset, actionLabel */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience, RootMode } = Me.imports.lib;
const logDebug = Convenience.logDebug;

const { Gio } = imports.gi;
const Gettext = imports.gettext.domain('ShutdownTimer');
const _ = Gettext.gettext;

let installCancel;

/**
 *
 * @param action
 * @param logInstall
 */
function installAction(action, logInstall) {
  if (installCancel !== undefined) {
    logDebug('Trigger cancel install.');
    installCancel.cancel();
  } else {
    logDebug(`Trigger ${action} action.`);
    installCancel = new Gio.Cancellable();
    _installAction(action, logInstall, installCancel).finally(() => {
      installCancel = undefined;
    });
  }
}

/**
 *
 */
function checkInstalled() {
  const scriptPath = RootMode.installedScriptPath();
  const isInstalled = scriptPath !== null;
  if (isInstalled) {
    logDebug(`Existing installation at: ${scriptPath}`);
  }
  return isInstalled;
}

/**
 *
 * @param action
 * @param logInstall
 * @param cancel
 */
async function _installAction(action, logInstall, cancel) {
  logInstall(`[${_('START')} ${actionLabel(action)}]`);
  try {
    if (action === 'install') {
      await RootMode.installScript(cancel, logInstall);
    } else {
      await RootMode.uninstallScript(cancel, logInstall);
    }
    logInstall(`[${_('END')} ${actionLabel(action)}]`);
  } catch (err) {
    logInstall(`[${_('FAIL')} ${actionLabel(action)}]\n# ${err}`);
    logError(err, 'InstallError');
  }
}

/**
 *
 * @param action
 */
function actionLabel(action) {
  return { install: _('install'), uninstall: _('uninstall') }[action];
}

/**
 *
 */
function reset() {
  if (installCancel !== undefined) {
    installCancel.cancel();
  }
  installCancel = undefined;
}
