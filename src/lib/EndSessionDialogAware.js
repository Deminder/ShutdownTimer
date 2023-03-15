// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported register, unregister, load, unload */
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { Gio } = imports.gi;
const { EventEmitter } = imports.misc.signals;
const { loadInterfaceXML } = imports.misc.fileUtils;
const { proxyPromise, logDebug } = Convenience;

const EndSessionDialogInf = loadInterfaceXML(
  'org.gnome.SessionManager.EndSessionDialog'
);
const EndSessionDialogProxy =
  Gio.DBusProxy.makeProxyWrapper(EndSessionDialogInf);

var ESDAware = class extends EventEmitter {
  constructor() {
    super();

    this.proxy = null;
    this.proxyPromise = proxyPromise(
      EndSessionDialogProxy,
      Gio.DBus.session,
      'org.gnome.Shell',
      '/org/gnome/SessionManager/EndSessionDialog'
    ).then(proxy => {
      this.proxyPromise = null;
      this.proxy = proxy;
    });
    this.proxySignalIds = [];
  }

  unreact() {
    for (const sigId of this.proxySignalIds) {
      this.proxy.disconnectSignal(sigId);
    }
    this.proxySignalIds = [];
  }

  react(handleFunc) {
    if (this.proxy === null) {
      handleFunc('proxy-missing');
    } else {
      this.unreact();
      this.proxySignalIds = ['Canceled', 'Closed'].map(name =>
        this.proxy.connectSignal(name, () => {
          this.unreact();
          handleFunc(name);
        })
      );
    }
  }

  destroy() {
    if (this.proxyPromise !== null)
      this.proxyPromise.then(() => {
        this.proxy = null;
      });
    else {
      this.unreact();
      this.proxy = null;
    }
  }
};
