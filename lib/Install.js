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

var installCancel;
let settings;

function logInstall(message) {
  message = ["[", "#"].includes(message[0]) ? message : " " + message;
  settings.set_string(
    "install-log-text-value",
    settings.get_string("install-log-text-value") + message + "\n"
  );
}

function installAction(action) {
  if (installCancel != null) {
    installCancel.cancel();
  } else {
    installCancel = new Gio.Cancellable();
    _installAction(action, installCancel).finally(() => {
      installCancel = null;
      _updateInstalledStatus();
    });
  }
}

function _updateInstalledStatus() {
  const scriptPath = RootMode.installedScriptPath();
  const isInstalled = scriptPath !== null;
  if (isInstalled) {
    logDebug("Existing installation at: " + scriptPath);
  }
  if (isInstalled !== settings.get_boolean("install-policy-value")) {
    settings.set_boolean("install-policy-value", isInstalled);
  }
}

async function _installAction(action, cancel) {
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
  logDebug("Reseting install log text.");
  // clear install log
  settings.set_string("install-log-text-value", "");
  if (installCancel != null) {
    installCancel.cancel();
  }
  installCancel = undefined;
}
