/*
  AUTHOR: Deminder
*/

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { WAKE_MODES, MODES, modeLabel } = Me.imports.prefs;
const { Convenience, InfoFetcher, ScheduleInfo } = Me.imports.lib;
const logDebug = Convenience.logDebug;

const { GObject, GLib, St } = imports.gi;

// menu items
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider;
const Switcher = imports.ui.switcherPopup;
const PadOsd = imports.ui.padOsd;

// translations
const Gettext = imports.gettext.domain("ShutdownTimer");
const _ = Gettext.gettext;
const _n = Gettext.ngettext;

let ACTIONS;
let settings;

var ShutdownTimer = GObject.registerClass(
  class ShutdownTimer extends PopupMenu.PopupSubMenuMenuItem {
    _init() {
      super._init("", true);
      // track external shutdown and wake schedule
      this.infoFetcher = new InfoFetcher.InfoFetcher();
      this.idleSourceIds = {};
      this.checkRunning = false;
      this.externalScheduleInfo = new ScheduleInfo.ScheduleInfo({
        external: true,
      });
      this.externalWakeInfo = new ScheduleInfo.ScheduleInfo({
        external: false,
        mode: "wake",
      });
      this.internalScheduleInfo = new ScheduleInfo.ScheduleInfo({
        external: false,
        deadline: settings.get_int("shutdown-timestamp-value"),
        mode: settings.get_string("shutdown-mode-value"),
      });

      // submenu in status area menu with slider and toggle button
      this.sliderItems = {};
      this.sliders = {};
      ["shutdown", "wake"].forEach((prefix) => {
        const [item, slider] = _createSliderItem(prefix);
        this.sliderItems[prefix] = item;
        this.sliders[prefix] = slider;
        this._onShowSliderChanged(prefix);
      });
      this.switcher = new PopupMenu.PopupSwitchMenuItem("", false);
      _disconnectOnDestroy(this.switcher, [
        ["toggled", this._onToggle.bind(this)],
      ]);
      this.switcherSettingsButton = new St.Button({
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: _("Settings"),
        style_class: "system-menu-action settings-button",
      });
      this.switcherSettingsButton.child = new St.Icon({
        icon_name: "emblem-system-symbolic",
        style_class: "popup-menu-icon",
      });
      _disconnectOnDestroy(this.switcherSettingsButton, [
        [
          "clicked",
          () => {
            ExtensionUtils.openPrefs();
          },
        ],
      ]);
      this.switcher.add_child(this.switcherSettingsButton);

      this._onShowSettingsButtonChanged();
      this._updateSwitchLabel();
      this.icon.icon_name = "system-shutdown-symbolic";
      this.menu.addMenuItem(this.switcher);
      // make switcher toggle without popup menu closing
      this.switcher.disconnect(this.switcher._activateId);
      // dummy for clean disconnect
      this.switcher._activateId = this.switcher.connect_after(
        "activate",
        () => {}
      );
      this.menu.addMenuItem(this.sliderItems["shutdown"]);

      this.modeItems = MODES.map((mode) => {
        const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
        _disconnectOnDestroy(modeItem, [
          [
            "activate",
            () => {
              this._startMode(mode);
            },
          ],
        ]);
        this.menu.addMenuItem(modeItem);
        return [mode, modeItem];
      });

      this.wakeItems = [
        new PopupMenu.PopupSeparatorMenuItem(),
        this.sliderItems["wake"],
        ...WAKE_MODES.map((mode) => {
          const modeItem = new PopupMenu.PopupMenuItem(modeLabel(mode));
          if (mode === "wake") {
            this.wakeModeItem = modeItem;
          }
          _disconnectOnDestroy(modeItem, [
            [
              "activate",
              () => {
                ACTIONS.wakeAction(mode, _getSliderMinutes("wake")).then(() => {
                  this.guiIdle(() => {
                    this.infoFetcher.updateScheduleInfo();
                  });
                });
              },
            ],
          ]);
          return modeItem;
        }),
      ];
      this._updateWakeModeItem();
      this.wakeItems.forEach((item) => {
        this.menu.addMenuItem(item);
      });
      this._updateShownWakeItems();
      this._updateShownModeItems();
      this._updateSelectedModeItems();
      this._onInternalShutdownTimestampChanged();

      // start root mode update loop
      this.infoFetcher.startScheduleInfoLoop(
        this._externalScheduleInfoTick.bind(this)
      );

      // handlers for changed values in settings
      this.settingsHandlerIds = [
        ["shutdown-max-timer-value", this._updateSwitchLabel.bind(this)],
        ["wake-max-timer-value", this._updateWakeModeItem.bind(this)],
        [
          "shutdown-slider-value",
          () => {
            this._updateSlider("shutdown");
            this._updateSwitchLabel();
          },
        ],
        [
          "wake-slider-value",
          () => {
            this._updateSlider("wake");
            this._updateWakeModeItem();
          },
        ],
        ["root-mode-value", this._onRootModeChanged.bind(this)],
        ["show-settings-value", this._onShowSettingsButtonChanged.bind(this)],
        [
          "show-shutdown-slider-value",
          () => this._onShowSliderChanged("shutdown"),
        ],
        ["show-wake-slider-value", () => this._onShowSliderChanged("wake")],
        ["show-wake-items-value", this._updateShownWakeItems.bind(this)],
        ["show-shutdown-mode-value", this._updateShownModeItems.bind(this)],
        ["shutdown-mode-value", this._onModeChange.bind(this)],
        [
          "shutdown-timestamp-value",
          this._onInternalShutdownTimestampChanged.bind(this),
        ],
      ].map(([label, func]) => settings.connect("changed::" + label, func));
    }

    guiIdle(func) {
      const sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        func();
        delete this.idleSourceIds[sourceId];
        return GLib.SOURCE_REMOVE;
      });
      this.idleSourceIds[sourceId] = 1;
    }

    _onRootModeChanged() {
      Promise.all([
        ACTIONS.maybeStopRootModeProtection(this.internalScheduleInfo),
        ACTIONS.maybeStartRootModeProtection(this.internalScheduleInfo),
      ]).then(() => {
        this.infoFetcher.updateScheduleInfo();
        this._updateSwitchLabel();
      });
    }

    _onModeChange() {
      // redo Root-mode protection
      ACTIONS.maybeStopRootModeProtection(this.internalScheduleInfo, true)
        .then(() => {
          this._updateCurrentMode();
          logDebug("Shutdown mode: " + this.internalScheduleInfo.mode);
          this.guiIdle(() => {
            this._updateSelectedModeItems();
            this.infoFetcher.updateScheduleInfo();
          });
        })
        .then(() =>
          ACTIONS.maybeStartRootModeProtection(this.internalScheduleInfo)
        );
    }

    _updateCurrentMode() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        mode: settings.get_string("shutdown-mode-value"),
      });

      ACTIONS.onShutdownScheduleChange(this.internalScheduleInfo);
      this._updateShutdownInfo();
    }

    _onInternalShutdownTimestampChanged() {
      this.internalScheduleInfo = this.internalScheduleInfo.copy({
        deadline: settings.get_int("shutdown-timestamp-value"),
      });

      ACTIONS.onShutdownScheduleChange(this.internalScheduleInfo);
      this.switcher.setToggleState(this.internalScheduleInfo.scheduled);
      this._updateShutdownInfo();
    }

    /* Schedule Info updates */
    _externalScheduleInfoTick(info, wakeInfo) {
      this.externalScheduleInfo = this.externalScheduleInfo.copy({ ...info });
      this.externalWakeInfo = this.externalWakeInfo.copy({ ...wakeInfo });
      this.guiIdle(() => {
        this._updateShutdownInfo();
      });
    }

    _updateShownModeItems() {
      const activeModes = settings
        .get_string("show-shutdown-mode-value")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => MODES.includes(s));
      this.modeItems.forEach(([mode, item]) => {
        const position = activeModes.indexOf(mode);
        if (position > -1) {
          this.menu.moveMenuItem(item, position + 2);
        }
        item.visible = position > -1;
      });
    }

    _updateShutdownInfo() {
      let wakeLabel = this.externalWakeInfo.scheduled
        ? "\n" + this.externalWakeInfo.label
        : "";

      if (this.checkRunning) {
        this.label.text = _("Waiting for confirmation") + wakeLabel;
        return;
      }
      const info = this.externalScheduleInfo.isMoreUrgendThan(
        this.internalScheduleInfo
      )
        ? this.externalScheduleInfo
        : this.internalScheduleInfo;
      this.label.text = info.label + wakeLabel;
    }

    _updateSelectedModeItems() {
      this.modeItems.forEach(([mode, item]) => {
        item.setOrnament(
          mode === this.internalScheduleInfo.mode
            ? PopupMenu.Ornament.DOT
            : PopupMenu.Ornament.NONE
        );
      });
    }

    // update timer value if slider has changed
    _updateSlider(prefix) {
      this.sliders[prefix].value =
        settings.get_int(prefix + "-slider-value") / 100.0;
    }

    _updateSwitchLabel() {
      const minutes = _getSliderMinutes("shutdown");
      let label = `${minutes} ${_n("min", "mins", Math.abs(minutes))}`;
      if (settings.get_boolean("root-mode-value")) {
        label += " " + _("(protect)");
      }
      this.switcher.label.text = label;
    }

    _updateWakeModeItem() {
      const minutes = _getSliderMinutes("wake");
      const hours = Math.floor(minutes / 60);
      const hoursStr =
        hours !== 0 ? `${hours} ${_n("hour", "hours", Math.abs(hours))} ` : "";
      this.wakeModeItem.label.text =
        modeLabel("wake") +
        ` ${hoursStr}${minutes % 60} ${_n(
          "minute",
          "minutes",
          Math.abs(minutes)
        )}`;
    }

    _onShowSettingsButtonChanged() {
      this.switcherSettingsButton.visible = settings.get_boolean(
        "show-settings-value"
      );
    }

    _updateShownWakeItems() {
      this.wakeItems.forEach((item) => {
        item.visible = settings.get_boolean("show-wake-items-value");
      });
      this._onShowSliderChanged("wake");
    }

    _onShowSliderChanged(settingsPrefix) {
      this.sliderItems[settingsPrefix].visible =
        (settingsPrefix !== "wake" ||
          settings.get_boolean("show-wake-items-value")) &&
        settings.get_boolean(`show-${settingsPrefix}-slider-value`);
    }

    _startMode(mode) {
      settings.set_string("shutdown-mode-value", mode);
      ACTIONS.startSchedule(_getSliderMinutes("shutdown"));
    }

    // toggle button starts/stops shutdown timer
    _onToggle() {
      if (this.switcher.state) {
        // start shutdown timer
        ACTIONS.startSchedule(_getSliderMinutes("shutdown"));
        Promise.all([
          ACTIONS.maybeStartRootModeProtection(this.internalScheduleInfo),
          ACTIONS.maybeStartWake(),
        ]).then(() => {
          this.infoFetcher.updateScheduleInfo();
        });
      } else {
        // stop shutdown timer
        ACTIONS.stopSchedule();
        Promise.all([
          ACTIONS.maybeStopRootModeProtection(this.internalScheduleInfo),
          ACTIONS.maybeStopWake(),
        ]).then(() => {
          this.infoFetcher.updateScheduleInfo();
        });
      }
    }

    destroy() {
      this.infoFetcher.stopScheduleInfoLoop();
      this.settingsHandlerIds.forEach((handlerId) => {
        settings.disconnect(handlerId);
      });
      Object.keys(this.idleSourceIds).forEach((sourceId) => {
        GLib.Source.remove(sourceId);
      });
      super.destroy();
    }
  }
);

function init(settingsObj, actions) {
  settings = settingsObj;
  ACTIONS = actions;
}

function _getSliderMinutes(prefix) {
  let sliderValue = settings.get_int(prefix + "-slider-value") / 100.0;
  return Math.floor(
    sliderValue * settings.get_int(prefix + "-max-timer-value")
  );
}

function _disconnectOnDestroy(item, connections) {
  const handlerIds = connections.map(([label, func]) =>
    item.connect(label, func)
  );
  const destroyId = item.connect("destroy", () => {
    handlerIds.concat(destroyId).forEach((handlerId) => {
      item.disconnect(handlerId);
    });
  });
}

function _createSliderItem(settingsPrefix) {
  const sliderValue =
    settings.get_int(settingsPrefix + "-slider-value") / 100.0;
  const item = new PopupMenu.PopupBaseMenuItem({ activate: false });
  const sliderIcon = new St.Icon({
    icon_name:
      settingsPrefix === "wake"
        ? "alarm-symbolic"
        : "preferences-system-time-symbolic",
    style_class: "popup-menu-icon",
  });
  item.add(sliderIcon);
  const slider = new Slider.Slider(sliderValue);
  _disconnectOnDestroy(slider, [
    [
      "notify::value",
      () => {
        settings.set_int(settingsPrefix + "-slider-value", slider.value * 100);
      },
    ],
  ]);
  item.add_child(slider);
  return [item, slider];
}
