// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gio from 'gi://Gio';
import * as FileUtils from 'resource:///org/gnome/shell/misc/fileUtils.js';
import { proxyPromise } from './util.js';

export class ESDAware {
  resolve = null;

  constructor() {
    const EndSessionDialogInf = FileUtils.loadInterfaceXML(
      'org.gnome.SessionManager.EndSessionDialog'
    );
    const EndSessionDialogProxy =
      Gio.DBusProxy.makeProxyWrapper(EndSessionDialogInf);
    this.proxy = undefined;
    proxyPromise(
      EndSessionDialogProxy,
      Gio.DBus.session,
      'org.gnome.Shell',
      '/org/gnome/SessionManager/EndSessionDialog'
    ).then(proxy => {
      if (this.proxy === undefined) {
        proxy.connectSignal('Canceled', () => this.#done('cancel'));
        proxy.connectSignal('Closed', () => this.#done('close'));
        this.proxy = proxy;
      }
    });
  }

  destroy() {
    this.#done('destroy');
    this.proxy = null;
  }

  #done(result) {
    if (this.resolve !== null) {
      this.resolve(result);
      this.resolve = null;
    }
  }

  dialogSignal() {
    return new Promise(resolve => {
      this.resolve = resolve;
    });
  }
}
