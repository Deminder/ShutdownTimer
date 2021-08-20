/*
  AUTHOR: Deminder
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

let endSessionDialogSignalId, endSessionDialog, registered;

function unregister() {
  registered = false;
}
function register() {
  registered = true;
}

function load(cancelAction) {
  if (endSessionDialog === undefined) {
    endSessionDialog = proxyPromise(
      EndSessionDialogProxy,
      Gio.DBus.session,
      'org.gnome.Shell',
      '/org/gnome/SessionManager/EndSessionDialog'
    );
    // stop schedule if endSessionDialog cancel button is activated
    endSessionDialog
      .then(proxy => {
        logDebug('Connect for cancel of endSessionDialog...');
        endSessionDialogSignalId = proxy.connectSignal('Canceled', () => {
          if (registered) {
            logDebug('Stopping schedule due to endSessionDialog cancel.');
            cancelAction();
          }
        });
      })
      .catch(err => {
        logError(err, 'EndSessionDialogProxyError');
      });
  }
}

function unload() {
  if (endSessionDialog !== undefined) {
    const signalId = endSessionDialogSignalId;
    if (signalId !== undefined) {
      endSessionDialog
        .then(proxy => {
          proxy.disconnectSignal(signalId);
        })
        .catch(err => {
          logError(err, 'EndSessionDialogProxyError');
        });
    }
    endSessionDialog = undefined;
    endSessionDialogSignalId = undefined;
  }
}
