// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { gettext as _, ngettext as _n, pgettext as C_ } from './translation.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
  foregroundActive,
  observeForegroundActive,
  unobserveForegroundActive,
} from './session-mode-aware.js';
import {
  modeLabel,
  MODES,
  WAKE_MODES,
  durationString,
  longDurationString,
  absoluteTimeString,
  getSliderMinutesFromSettings,
} from './schedule-info.js';

/**
 * The ShutdownTimerItem controls wake/shutdown action time and mode.
 * Additionally, it shows wake and external/internal shutdown schedules.
 *
 * The external schedule of the `shutdown` command is fetched by the InfoFetcher.
 * Note that there is no external schedule for `suspend`.
 */
const ShutdownTimerItem = GObject.registerClass(
  {
    Properties: {
      'shutdown-text': GObject.ParamSpec.string(
        'shutdown-text',
        '',
        '',
        GObject.ParamFlags.READWRITE,
        ''
      ),
      'indicator-icon-name': GObject.ParamSpec.string(
        'indicator-icon-name',
        '',
        '',
        GObject.ParamFlags.READWRITE,
        'go-down-symbolic'
      ),
    },
    Signals: {
      'open-preferences': {},
      shutdown: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerItem extends QuickSettings.QuickMenuToggle {
    _init({ path, settings, info }) {
      const gicon = Gio.icon_new_for_string(
        `${path}/icons/shutdown-timer-symbolic.svg`
      );
      super._init({ gicon, accessible_name: _('Shutdown Timer') });
      this.info = info;
      this._settings = settings;
      this.shutdownTimerIcon = gicon;

      // submenu in status area menu with slider and toggle button
      this.sliderItems = {};
      this.sliders = {};
      ['shutdown', 'wake'].forEach(prefix => {
        const [item, slider] = this._createSliderItem(prefix);
        this.sliderItems[prefix] = item;
        this.sliders[prefix] = slider;
        this._onShowSliderChanged(prefix);
      });
      this.switcher = new PopupMenu.PopupSwitchMenuItem('', false);
      // start/stop shutdown timer
      this.switcher.connect('toggled', () =>
        this.emit('shutdown', this.switcher.state)
      );
      this.switcherSettingsButton = new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: _('Settings'),
        style_class: 'system-menu-action settings-button',
      });
      this.switcherSettingsButton.child = new St.Icon({
        icon_name: 'emblem-system-symbolic',
        style_class: 'popup-menu-icon',
      });
      this.switcherSettingsButton.connect('clicked', () =>
        this.emit('open-preferences')
      );
      this.switcher.add_child(this.switcherSettingsButton);

      this.menu.addMenuItem(this.switcher);
      // make switcher toggle without popup menu closing
      this.switcher.activate = __ => {
        if (this.switcher._switch.mapped) {
          this.switcher.toggle();
        }
      };
      this.menu.addMenuItem(this.sliderItems['shutdown']);

      this.modeItems = MODES.map(mode => {
        const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
        modeItem.connect('activate', () => {
          this._settings.set_string('shutdown-mode-value', mode);
          this.emit('shutdown', true);
        });
        this.menu.addMenuItem(modeItem);
        return [mode, modeItem];
      });

      this.wakeItems = [
        new PopupMenu.PopupSeparatorMenuItem(),
        this.sliderItems['wake'],
        ...WAKE_MODES.map(mode => {
          const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
          if (mode === 'wake') {
            this.wakeModeItem = modeItem;
          }
          modeItem.connect('activate', () =>
            this.emit('wake', mode === 'wake')
          );
          return modeItem;
        }),
      ];
      this.wakeItems.forEach(item => {
        this.menu.addMenuItem(item);
      });
      this._updateWakeModeItem();
      this._updateSwitchLabel();

      // handlers for changed values in settings
      const settingsHandlerIds = [
        [
          [
            'shutdown-max-timer-value',
            'nonlinear-shutdown-slider-value',
            'shutdown-ref-timer-value',
            'show-shutdown-absolute-timer-value',
            'root-mode-value',
            'shutdown-slider-value',
          ],
          () => this._updateSwitchLabel(),
        ],
        [
          [
            'wake-max-timer-value',
            'wake-ref-timer-value',
            'show-wake-absolute-timer-value',
            'nonlinear-wake-slider-value',
            'wake-slider-value',
          ],
          () => this._updateWakeModeItem(),
        ],
        [['shutdown-slider-value'], () => this._updateSlider('shutdown')],
        [['wake-slider-value'], () => this._updateSlider('wake')],
        [
          [
            'show-wake-items-value',
            'show-shutdown-mode-value',
            'show-shutdown-slider-value',
            'show-wake-slider-value',
            'show-shutdown-indicator-value',
            'show-settings-value',
            'shutdown-mode-value',
            'shutdown-timestamp-value',
          ],
          () => this._sync(),
        ],
      ]
        .flatMap(([names, func]) => names.map(n => [n, func]))
        .map(([name, func]) =>
          this._settings.connect(`changed::${name}`, func)
        );

      this.connect('clicked', () => this.switcher.toggle());
      observeForegroundActive(this, () => this._sync());
      const tickHandlerId = setInterval(() => this.updateShutdownInfo(), 1000);
      this.connect('destroy', () => {
        unobserveForegroundActive(this);
        clearInterval(tickHandlerId);
        settingsHandlerIds.forEach(handlerId => {
          this._settings.disconnect(handlerId);
        });
      });
    }

    _sync() {
      // Update wake mode items
      this.wakeItems.forEach(item => {
        item.visible = this._settings.get_boolean('show-wake-items-value');
      });
      this._onShowSliderChanged('wake');

      // Update shutdown mode items
      const activeModes = this._settings
        .get_string('show-shutdown-mode-value')
        .split(',')
        .map(s => MODES.find(m => m[0] === s.trim().toLowerCase()[0]))
        .filter(mode => !!mode);
      this.modeItems.forEach(([mode, item]) => {
        const position = activeModes.indexOf(mode);
        if (position > -1) {
          this.menu.moveMenuItem(item, position + 2);
        }
        item.visible = position > -1;
      });
      const info = this.info.internalShutdown;
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === info.mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE
        );
      });
      this.title = modeLabel(info.mode);

      this._onShowSliderChanged('shutdown');

      // Update switcher
      this.switcher.setToggleState(info.scheduled);
      this.updateShutdownInfo();
      this.switcherSettingsButton.visible =
        foregroundActive() && this._settings.get_boolean('show-settings-value');
    }

    updateShutdownInfo() {
      const showIndicator = this._settings.get_boolean(
        'show-shutdown-indicator-value'
      );
      const info = this.info.externalShutdown.isMoreUrgendThan(
        this.info.internalShutdown
      )
        ? this.info.externalShutdown
        : this.info.internalShutdown;

      this.set({
        checked: this.info.internalShutdown.scheduled,
        shutdownText:
          info.scheduled && showIndicator
            ? info.secondsLeft > 0
              ? durationString(info.secondsLeft)
              : _('now')
            : '',
        indicatorIconName:
          showIndicator &&
          (this.info.internalShutdown.scheduled ||
            this.info.externalShutdown.scheduled)
            ? 'go-down-symbolic'
            : '',
      });
      this.menu.setHeader(
        this.shutdownTimerIcon,
        _('Shutdown Timer'),
        [info.label, this.info.externalWake.label].filter(v => !!v).join('\n')
      );
      if (this._settings.get_boolean('show-shutdown-absolute-timer-value')) {
        this._updateSwitchLabel();
      }
      if (this._settings.get_boolean('show-wake-absolute-timer-value')) {
        this._updateWakeModeItem();
      }
      this._updateSubtitle();
    }

    // update timer value if slider has changed
    _updateSlider(prefix) {
      this.sliders[prefix].value =
        this._settings.get_double(`${prefix}-slider-value`) / 100.0;
    }

    _createSliderItem(settingsPrefix) {
      const valueName = `${settingsPrefix}-slider-value`;
      const sliderValue = this._settings.get_double(valueName) / 100.0;
      const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
      const sliderIcon = new St.Icon({
        icon_name:
          settingsPrefix === 'wake'
            ? 'alarm-symbolic'
            : 'system-shutdown-symbolic',
        style_class: 'popup-menu-icon',
      });
      item.add(sliderIcon);
      const slider = new Slider.Slider(sliderValue);
      slider.connect('notify::value', () => {
        const v = slider.value * 100;
        if (v !== this._settings.get_double(valueName))
          this._settings.set_double(valueName, v);
      });
      item.add_child(slider);
      return [item, slider];
    }

    get shutdownTimeStr() {
      const minutes = Math.abs(
        getSliderMinutesFromSettings(this._settings, 'shutdown')
      );
      return this._settings.get_boolean('show-shutdown-absolute-timer-value')
        ? absoluteTimeString(minutes, C_('absolute time notation', '%a, %R'))
        : longDurationString(
            minutes,
            h => _n('%s hr', '%s hrs', h),
            m => _n('%s min', '%s mins', m)
          );
    }

    _updateSwitchLabel() {
      this.switcher.label.text = this._settings.get_boolean('root-mode-value')
        ? _('%s (protect)').format(this.shutdownTimeStr)
        : this.shutdownTimeStr;

      if (this._settings.get_string('wake-ref-timer-value') === 'shutdown') {
        this._updateWakeModeItem();
      }
      if (!this.info.internalShutdown.scheduled) {
        this._updateSubtitle();
      }
    }

    _updateSubtitle() {
      this.subtitle = this.info.internalShutdown.scheduled
        ? this._settings.get_boolean('show-shutdown-absolute-timer-value')
          ? this.info.internalShutdown.absoluteTimeString
          : durationString(this.info.internalShutdown.secondsLeft)
        : this.shutdownTimeStr;
    }

    _updateWakeModeItem() {
      const minutes = Math.abs(this.wake_minutes);
      const abs = this._settings.get_boolean('show-wake-absolute-timer-value');
      this.wakeModeItem.label.text = (
        abs
          ? C_('WakeButtonText', '%s at %s')
          : C_('WakeButtonText', '%s after %s')
      ).format(
        modeLabel('wake'),
        abs
          ? absoluteTimeString(minutes, C_('absolute time notation', '%a, %R'))
          : longDurationString(
              minutes,
              h => _n('%s hour', '%s hours', h),
              m => _n('%s minute', '%s minutes', m)
            )
      );
    }

    _onShowSliderChanged(settingsPrefix) {
      this.sliderItems[settingsPrefix].visible =
        (settingsPrefix !== 'wake' ||
          this._settings.get_boolean('show-wake-items-value')) &&
        this._settings.get_boolean(`show-${settingsPrefix}-slider-value`);
    }
  }
);

export const ShutdownTimerIndicator = GObject.registerClass(
  {
    Properties: {
      'wake-minutes': GObject.ParamSpec.int(
        'wake-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
      'shutdown-minutes': GObject.ParamSpec.int(
        'shutdown-minutes',
        '',
        '',
        GObject.ParamFlags.READABLE,
        0
      ),
    },
    Signals: {
      'open-preferences': {},
      shutdown: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerIndicator extends QuickSettings.SystemIndicator {
    _init({ path, settings, info }) {
      super._init();
      const item = new ShutdownTimerItem({ path, settings, info });
      this._shutdownTimerItem = item;

      item.connect('shutdown', (__, shutdown) =>
        this.emit('shutdown', shutdown)
      );
      item.connect('wake', (__, wake) => this.emit('wake', wake));
      item.connect('open-preferences', () => this.emit('open-preferences'));

      const icon = new St.Icon({ style_class: 'system-status-icon' });
      const updateIcon = () => {
        const name = item.indicatorIconName;
        icon.visible = !!name;
        if (icon.visible) icon.iconName = name;
        this._syncIndicatorsVisible();
      };

      const scheduleLabel = new St.Label({
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      const updateLabel = () => {
        const text = item.shutdownText;
        scheduleLabel.text = text;
        scheduleLabel.visible = !!text;
        this._syncIndicatorsVisible();
      };

      this.add_actor(icon);
      this.add_child(scheduleLabel);

      item.connect('notify::indicator-icon-name', () => updateIcon());
      item.connect('notify::shutdown-text', () => updateLabel());

      updateLabel();
      updateIcon();

      this.quickSettingsItems.push(item);
      this.connect('destroy', () => {
        this.quickSettingsItems.forEach(i => i.destroy());
      });
      item.connect('destroy', () => {
        // Mitigate already destroyed error when logging out
        // Does js/ui/layout.js:256 destroy quickSettingsItems?
        this.quickSettingsItems = [];
      });
    }

    setInfo(info) {
      this._shutdownTimerItem.info = info;
      this._shutdownTimerItem.updateShutdownInfo();
    }
  }
);
