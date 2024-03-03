// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { throttleTimeout, logDebug } from './util.js';
import {
  foregroundActive,
  observeForegroundActive,
  unobserveForegroundActive,
} from './session-mode-aware.js';

export class Textbox {
  textboxes = [];
  constructor({ settings }) {
    this.settings = settings;
    [this.syncThrottled, this.syncThrottledCancel] = throttleTimeout(
      this.sync.bind(this),
      50
    );
    this.showSettingsId = settings.connect(
      'changed::show-textboxes-value',
      this.sync.bind(this)
    );
    observeForegroundActive(this, fgActive => {
      if (!fgActive) {
        this.hideAll();
      }
    });
  }

  destroy() {
    if (this.showSettingsId) {
      unobserveForegroundActive(this);
      this.hideAll();
      this.settings.disconnect(this.showSettingsId);
      this.showSettingsId = null;
    }
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
      textbox.visible = this.settings.get_boolean('show-textboxes-value');
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

  /**
   * Show a textbox message on the primary monitor
   *
   * @param textmsg
   */
  showTextbox(textmsg) {
    if (textmsg && foregroundActive()) {
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
      Main.uiGroup.add_child(textbox);
      this.textboxes.unshift(textbox);
      this.syncThrottled();
    }
  }
}
