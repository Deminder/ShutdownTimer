// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { InfoFetcher } from './info-fetcher.js';
import { Textbox } from './text-box.js';
import { gettext as _, ngettext as _n, pgettext as C_ } from './translation.js';
import * as SessionModeAware from './session-mode-aware.js';
import { getShutdownScheduleFromSettings } from './schedule-info.js';
import {
  ShutdownTimerName,
  ShutdownTimerObjectPath,
} from '../dbus-service/shutdown-timer-dbus.js';

import {
  foregroundActive,
  observeForegroundActive,
  unobserveForegroundActive,
} from './session-mode-aware.js';
import {
  durationString,
  longDurationString,
  absoluteTimeString,
  getSliderMinutesFromSettings,
  ScheduleInfo,
} from './schedule-info.js';

import { logDebug, proxyPromise } from './util.js';
import {
  WAKE_ACTIONS,
  checkText,
  actionLabel,
  ACTIONS,
  mapLegacyAction,
} from '../dbus-service/action.js';

/**
 * The ShutdownTimerQuickMenuToggle controls wake/shutdown action time and mode.
 * Additionally, it shows wake and external/internal shutdown schedules.
 *
 * The external schedule of the `shutdown` command is fetched by the InfoFetcher.
 * Note that there is no external schedule for `suspend`.
 */
const ShutdownTimerQuickMenuToggle = GObject.registerClass(
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
        param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerQuickMenuToggle extends QuickSettings.QuickMenuToggle {
    _init({ path, settings }) {
      const gicon = Gio.icon_new_for_string(
        `${path}/icons/shutdown-timer-symbolic.svg`
      );
      super._init({ gicon, accessible_name: _('Shutdown Timer') });
      this.info = {
        internalShutdown: getShutdownScheduleFromSettings(settings),
        externalShutdown: new ScheduleInfo({ external: true }),
        externalWake: new ScheduleInfo({ mode: 'wake' }),
        state: 'inactive',
      };
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
        this.emit(
          'shutdown',
          this.switcher.state,
          this.info.internalShutdown.mode
        )
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

      this.modeItems = Object.keys(ACTIONS).map(action => {
        const modeItem = new PopupMenu.PopupMenuItem(actionLabel(action));
        modeItem.connect('activate', () => {
          this.emit('shutdown', true, action);
        });
        this.menu.addMenuItem(modeItem);
        return [action, modeItem];
      });

      this.wakeItems = [
        new PopupMenu.PopupSeparatorMenuItem(),
        this.sliderItems['wake'],
        ...Object.keys(WAKE_ACTIONS).map(action => {
          const modeItem = new PopupMenu.PopupMenuItem(actionLabel(action));
          if (action === 'wake') {
            this.wakeModeItem = modeItem;
          }
          modeItem.connect('activate', () =>
            this.emit('wake', action === 'wake')
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
      const activeActions = this._settings
        .get_string('show-shutdown-mode-value')
        .split(',')
        .map(s => mapLegacyAction(s.trim()))
        .filter(action => action in ACTIONS);
      logDebug('[menu-item]', activeActions);
      this.modeItems.forEach(([action, item]) => {
        const position = activeActions.indexOf(action);
        if (position > -1) {
          this.menu.moveMenuItem(item, position + 2);
        }
        item.visible = position > -1;
      });

      this._onShowSliderChanged('shutdown');

      this.switcherSettingsButton.visible =
        foregroundActive() && this._settings.get_boolean('show-settings-value');

      this.updateShutdownInfo();
    }

    updateShutdownInfo() {
      const schedule = this.info.internalShutdown;
      const externalSchedule = this.info.externalShutdown;
      const externalWake = this.info.externalWake;
      const urgendSchedule = externalSchedule.isMoreUrgendThan(schedule)
        ? externalSchedule
        : schedule;
      const active = schedule.scheduled || this.info.state !== 'inactive';
      const checking = this.info.state === 'check';
      const showIndicator = this._settings.get_boolean(
        'show-shutdown-indicator-value'
      );

      // Update Item
      this.set({
        checked: active,
        shutdownText:
          urgendSchedule.scheduled && showIndicator
            ? urgendSchedule.secondsLeft > 0
              ? durationString(urgendSchedule.secondsLeft)
              : _('now')
            : '',
        indicatorIconName:
          showIndicator && (schedule.scheduled || externalSchedule.scheduled)
            ? checking
              ? 'go-bottom-symbolic'
              : 'go-down-symbolic'
            : '',
      });
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === schedule.mode
            ? PopupMenu.Ornament.DOT
            : PopupMenu.Ornament.NONE
        );
      });
      this.title = actionLabel(schedule.mode);
      this.switcher.setToggleState(active);
      this.menu.setHeader(
        this.shutdownTimerIcon,
        _('Shutdown Timer'),
        [
          schedule.scheduled && checking
            ? _('Check {checktext} for {durationString}')
                .replace('{checktext}', checkText(schedule.mode))
                .replace(
                  '{durationString}',
                  durationString(
                    // Show seconds which passed since check started
                    Math.max(0, -schedule.secondsLeft)
                  )
                )
            : schedule.label,
          externalWake.label,
        ]
          .filter(v => !!v)
          .join('\n')
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
      const minutes = getSliderMinutesFromSettings(this._settings, 'wake');
      const abs = this._settings.get_boolean('show-wake-absolute-timer-value');
      this.wakeModeItem.label.text = (
        abs
          ? C_('WakeButtonText', '%s at %s')
          : C_('WakeButtonText', '%s after %s')
      ).format(
        actionLabel('wake'),
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

export const ShutdownTimerSystemIndicator = GObject.registerClass(
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
        param_types: [GObject.TYPE_BOOLEAN, GObject.TYPE_STRING],
      },
      wake: {
        param_types: [GObject.TYPE_BOOLEAN],
      },
    },
  },
  class ShutdownTimerSystemIndicator extends QuickSettings.SystemIndicator {
    _init({ path, settings }) {
      super._init();
      this._settings = settings;
      this._textbox = new Textbox({ settings });
      const item = new ShutdownTimerQuickMenuToggle({ path, settings });
      const infoFetcher = new InfoFetcher();
      const proxyCancel = new Gio.Cancellable();
      this._sdtProxy = null;
      this._initProxy(item, this._textbox, infoFetcher, proxyCancel).catch(
        err => {
          if (!proxyCancel.is_cancelled()) console.error('[sdt-proxy]', err);
        }
      );
      // React to changes in external shutdown and wake schedule
      infoFetcher.connect('changed', () => this._syncShutdownInfo());
      this._infoFetcher = infoFetcher;
      this._shutdownTimerItem = item;

      item.connect('shutdown', (__, shutdown, action) =>
        this.emit('shutdown', shutdown, action)
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

      const settingsIds = [
        'shutdown-mode-value',
        'shutdown-timestamp-value',
      ].map(n =>
        settings.connect(`changed::${n}`, () => this._syncShutdownInfo())
      );

      this.quickSettingsItems.push(item);
      this.connect('destroy', () => {
        settingsIds.forEach(settingsId => settings.disconnect(settingsId));
        proxyCancel.cancel();
        infoFetcher.destroy();
        this._infoFetcher = null;
        this._textbox.destroy();
        this.quickSettingsItems.forEach(i => i.destroy());
        this.quickSettingsItems = [];
        this._shutdownTimerItem = null;
        if (this._sdtProxy !== null) {
          this._sdtProxy.destroy();
          this._sdtProxy = null;
        }
        this._settings = null;
      });
      item.connect('destroy', () => {
        // Mitigate already destroyed error when logging out
        // Does js/ui/layout.js:256 destroy quickSettingsItems?
        this.quickSettingsItems = [];
      });
    }

    async _initProxy(item, textbox, infoFetcher, cancellable) {
      const proxy = await proxyPromise(
        ShutdownTimerName,
        Gio.DBus.session,
        'org.gnome.Shell',
        ShutdownTimerObjectPath,
        cancellable
      );
      if (cancellable?.is_cancelled()) return;
      item.connect('shutdown', (__, shutdown, action) => {
        logDebug('[menu-item] shutdown', shutdown, 'action', action);
        proxy
          .ScheduleShutdownAsync(shutdown, action)
          .catch(err => console.error('[shutdown]', err));
      });
      item.connect('wake', (__, wake) => {
        proxy
          .ScheduleWakeAsync(wake)
          .catch(err => console.error('[wake]', err));
      });

      const signalIds = [
        proxy.connectSignal('OnMessage', (__, ___, [msg]) => {
          textbox.showTextbox(msg);
        }),
        proxy.connectSignal('OnStateChange', (__, ___, [state]) => {
          logDebug('[menu-item] state:', state);
          this._state = state;
          this._syncShutdownInfo();
        }),
        proxy.connectSignal('OnExternalChange', () => {
          infoFetcher.refresh();
        }),
      ];
      proxy.destroy = function () {
        signalIds.forEach(signalId => this.disconnectSignal(signalId));
      };

      this._sdtProxy = proxy;
      [this._state] = await this._sdtProxy.GetStateAsync();
      if (cancellable?.is_cancelled()) return;
      logDebug('[sdt-proxy] state', this._state);
      this._syncShutdownInfo();
    }

    _syncShutdownInfo() {
      const item = this._shutdownTimerItem;
      if (this._state === 'action') {
        if (SessionModeAware.foregroundActive()) Main.overview.hide();
        this._textbox.hideAll();
      }
      item.info = {
        internalShutdown: getShutdownScheduleFromSettings(this._settings),
        externalShutdown: item.info.externalShutdown.copy({
          ...this._infoFetcher.shutdownInfo,
        }),
        externalWake: item.info.externalWake.copy({
          ...this._infoFetcher.wakeInfo,
        }),
        state: this._state,
      };
      item.updateShutdownInfo();
    }
  }
);
