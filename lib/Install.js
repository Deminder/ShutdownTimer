/*
  AUTHOR: Deminder
*/

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience, RootMode } = Me.imports.lib;
const logDebug = Convenience.logDebug;

const { Gio } = imports.gi;
// translations
const Gettext = imports.gettext.domain("ShutdownTimer");
const _ = Gettext.gettext;

let installCancel;

function installAction(action, logInstall) {
  if (installCancel != null) {
    logDebug("Trigger cancel install.");
    installCancel.cancel();
  } else {
    logDebug(`Trigger ${action} action.`);
    installCancel = new Gio.Cancellable();
    _installAction(action, logInstall, installCancel).finally(() => {
      installCancel = null;
    });
  }
}

function checkInstalled() {
  const scriptPath = RootMode.installedScriptPath();
  const isInstalled = scriptPath !== null;
  if (isInstalled) {
    logDebug("Existing installation at: " + scriptPath);
  }
  return isInstalled;
}

async function _installAction(action, logInstall, cancel) {
  logInstall(`[${_("START")} ${actionLabel(action)}]`);
  try {
    if (action === "install") {
      await RootMode.installScript(cancel, logInstall);
    } else {
      await RootMode.uninstallScript(cancel, logInstall);
    }
    logInstall(`[${_("END")} ${actionLabel(action)}]`);
  } catch (err) {
    logInstall(`[${_("FAIL")} ${actionLabel(action)}]\n# ${err}`);
    logError(err, "InstallError");
  }
}

function actionLabel(action) {
  return { install: _("install"), uninstall: _("uninstall") }[action];
}

function init(settingsRef) {
  settings = settingsRef;
}

function reset() {
  if (installCancel != null) {
    installCancel.cancel();
  }
  installCancel = undefined;
}
