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

let endSessionDialogPromise = null;
let wantConnectAction = null;
let registered = false;

function unregister() {
  registered = false;
}
function register() {
  registered = true;
}

function load(cancelAction) {
  wantConnectAction = cancelAction;
  _update();
}

function unload() {
  wantConnectAction = null;
  _update();
}

async function _update() {
  try {
    if (wantConnectAction && !endSessionDialogPromise) {
      endSessionDialogPromise = proxyPromise(
        EndSessionDialogProxy,
        Gio.DBus.session,
        'org.gnome.Shell',
        '/org/gnome/SessionManager/EndSessionDialog'
      );
    }
  } catch (err) {
    logError(err, 'EndSessionDialogProxyError');
  }
  if (endSessionDialogPromise) {
    const dialog = await endSessionDialogPromise;
    // and wantConnectAction may have changed after await
    if (wantConnectAction) {
      _connect(dialog, wantConnectAction);
    } else {
      _disconnect(dialog);
      endSessionDialogPromise = null;
    }
  }
}

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

function _disconnect(dialog) {
  const signalId = dialog['_cancelSignalId'];
  if (signalId) {
    logDebug('Disconnect cancel of endSessionDialog...');
    dialog.disconnectSignal(signalId);
  }
}
