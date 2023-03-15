// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

/* exported OsdTextbox */
const Main = imports.ui.main;
const { St, Clutter } = imports.gi;
const { EventEmitter } = imports.misc.signals;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Convenience } = Me.imports.lib;
const { logDebug, throttleTimeout } = Convenience;

var OsdTextbox = class extends EventEmitter {
  constructor() {
    super();
    [this.syncThrottled, this.syncThrottledCancel] = throttleTimeout(
      this.sync.bind(this),
      50
    );
    this._settings = ExtensionUtils.getSettings();
    this._showSettingId = this._settings.connect(
      'changed::show-textboxes-value',
      this.sync.bind(this)
    );
    this.textboxes = [];
  }

  sync() {
    this.syncThrottledCancel();
    // remove hidden textboxes
    this.textboxes = this.textboxes.filter(t => {
      if (t['_hidden']) {
        const sid = t['_sourceId'];
        if (sid) {
          clearTimeout(sid);
        }
        delete t['_sourceId'];
        t.destroy();
      }
      return !t['_hidden'];
    });
    const monitor = Main.layoutManager.primaryMonitor;
    let heightOffset = 0;
    this.textboxes.forEach((textbox, i) => {
      if (!('_sourceId' in textbox)) {
        // start fadeout of textbox after 3 seconds
        textbox['_sourceId'] = setTimeout(() => {
          textbox['_sourceId'] = 0;
          textbox.ease({
            opacity: 0,
            duration: 1000,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
              textbox['_hidden'] = 1;
              this.syncThrottled();
            },
          });
        }, 3000);
      }
      textbox.visible = this._settings.get_boolean('show-textboxes-value');
      if (!textbox.visible) return;

      if (i === 0) {
        heightOffset = -textbox.height / 2;
      }
      textbox.set_position(
        monitor.x + Math.floor(monitor.width / 2 - textbox.width / 2),
        monitor.y + Math.floor(monitor.height / 2 + heightOffset)
      );
      heightOffset += textbox.height + 10;
      if (textbox['_sourceId']) {
        // set opacity before fadeout starts
        textbox.opacity =
          i === 0
            ? 255
            : Math.max(
                25,
                25 + 230 * (1 - heightOffset / (monitor.height / 2))
              );
      }
    });
  }

  hideAll() {
    for (const t of this.textboxes) {
      t['_hidden'] = 1;
    }
    this.sync();
  }

  destroy() {
    this.hideAll();
    if (this._showSettingId) this._settings.disconnect(this._showSettingId);
  }

  /**
   * Show a textbox message on the screen
   *
   * @param textmsg
   */
  showTextbox(textmsg) {
    for (const t of this.textboxes) {
      // replace old textbox if it has the same text
      if (t.text === textmsg) {
        t['_hidden'] = 1;
      }
    }
    logDebug(`show textbox: ${textmsg}`);
    const textbox = new St.Label({
      style_class: 'textbox-label',
      text: textmsg,
      opacity: 0,
    });
    Main.uiGroup.add_actor(textbox);
    this.textboxes.unshift(textbox);
    this.syncThrottled();
  }
};
