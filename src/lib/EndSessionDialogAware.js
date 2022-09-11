/**
 * EndSessionDialogAware module
 *
 * @author Deminder <tremminder@gmail.com>
 * @copyright 2021
 * @license GNU General Public License v3.0
 */
/* exported register, unregister, load, unload */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { Gio } = imports.gi;
const { loadInterfaceXML } = imports.misc.fileUtils;
const { proxyPromise, logDebug } = Convenience;

const EndSessionDialogInf = loadInterfaceXML(
  'org.gnome.SessionManager.EndSessionDialog'
);
const EndSessionDialogProxy =
  Gio.DBusProxy.makeProxyWrapper(EndSessionDialogInf);

let endSessionDialog = null;
let onCancelAction = null;
let registered = false;

/**
 *
 */
function unregister() {
  registered = false;
}
/**
 *
 */
function register() {
  registered = true;
}

/**
 *
 * @param cancelAction
 */
function load(cancelAction) {
  onCancelAction = cancelAction;
  _update();
}

/**
 *
 */
function unload() {
  onCancelAction = null;
  _update();
}

/**
 *
 */
async function _update() {
  try {
    if (onCancelAction && !endSessionDialog) {
      endSessionDialog = await proxyPromise(
        EndSessionDialogProxy,
        Gio.DBus.session,
        'org.gnome.Shell',
        '/org/gnome/SessionManager/EndSessionDialog'
      );
    }
    if (endSessionDialog) {
      if (onCancelAction === null) {
        _disconnect(endSessionDialog);
        endSessionDialog = null;
      } else {
        _connect(endSessionDialog, onCancelAction);
      }
    }
  } catch (err) {
    logError(err, 'EndSessionDialogProxyError');
    endSessionDialog = null;
  }
}

/**
 *
 * @param dialog
 * @param cancelAction
 */
function _connect(dialog, cancelAction) {
  if (!('_cancelSignalId' in dialog)) {
    logDebug('Connect cancel of endSessionDialog...');
    dialog['_cancelSignalId'] = dialog.connectSignal('Canceled', () => {
      logDebug(
        `endSessionDialog cancel triggered. propagate registered: ${registered}`
      );
      if (registered) {
        cancelAction();
      }
    });
  }
}

/**
 *
 * @param dialog
 */
function _disconnect(dialog) {
  const signalId = dialog['_cancelSignalId'];
  if (signalId) {
    logDebug('Disconnect cancel of endSessionDialog...');
    dialog.disconnectSignal(signalId);
    delete dialog['_cancelSignalId'];
  }
}
