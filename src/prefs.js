// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { Install } from './modules/install.js';
import {
  actionLabel,
  ACTIONS,
  mapLegacyAction,
  supportedActions,
} from './dbus-service/action.js';
import { logDebug, Idle } from './modules/util.js';

const templateComponents = {
  shutdown: {
    'shutdown-mode': 'combo',
    'root-mode': 'switch',
    'show-end-session-dialog': 'switch',
    'shutdown-max-timer': 'adjustment',
    'shutdown-ref-timer': 'buffer',
    'shutdown-slider': 'adjustment',
    'nonlinear-shutdown-slider': 'adjustment',
  },
  wake: {
    'auto-wake': 'switch',
    'wake-max-timer': 'adjustment',
    'wake-ref-timer': 'buffer',
    'wake-slider': 'adjustment',
    'nonlinear-wake-slider': 'adjustment',
  },
  display: {
    'show-settings': 'switch',
    'show-shutdown-mode': 'buffer',
    'show-shutdown-slider': 'switch',
    'show-shutdown-indicator': 'switch',
    'show-shutdown-absolute-timer': 'switch',
    'show-textboxes': 'switch',
    'show-wake-slider': 'switch',
    'show-wake-items': 'switch',
    'show-wake-absolute-timer': 'switch',
  },
  check: {
    'check-command': 'textbuffer',
    'enable-check-command': 'switch',
  },
};

export default class ShutdownTimerPreferences extends ExtensionPreferences {
  /**
   * Fill the preferences window with preferences.
   *
   * The default implementation adds the widget
   * returned by getPreferencesWidget().
   *
   * @param {Adw.PreferencesWindow} window - the preferences window
   */
  fillPreferencesWindow(window) {
    const builder = Gtk.Builder.new();
    builder.add_from_file(
      this.dir.get_child('ui').get_child('prefs.ui').get_path()
    );

    const settings = this.getSettings();
    const handlers = [];
    const pageNames = ['install', 'shutdown', 'wake', 'display', 'check'].map(
      n => `shutdowntimer-prefs-${n}`
    );
    for (const name of pageNames) {
      const pageId = name.replaceAll('-', '_');
      const page = builder.get_object(pageId);
      const pageName = pageId.split('_').at(-1);
      if (!page) {
        throw new Error(`${pageId} not found!`);
      }
      if (pageName === 'check') {
        this.initCheckPage(builder);
      } else if (pageName === 'install') {
        const idle = new Idle();
        const install = new Install();
        this.initInstallPage(
          builder,
          this.dir.get_child('tool').get_child('installer.sh').get_path(),
          install,
          idle
        );
        window.connect('destroy', () => {
          idle.destroy();
          install.destroy();
        });
      }
      this.initPage(pageName, builder, settings);
      window.add(page);
    }
    const selPageName =
      pageNames[settings.get_int('preferences-selected-page-value')];
    if (selPageName) {
      window.set_visible_page_name(selPageName);
    }
    const pageVisHandlerId = window.connect('notify::visible-page-name', () => {
      logDebug(window.get_visible_page_name());
      settings.set_int(
        'preferences-selected-page-value',
        pageNames.indexOf(window.get_visible_page_name())
      );
    });
    handlers.push([window, pageVisHandlerId]);

    window.connect('destroy', () => {
      handlers.forEach(([comp, handlerId]) => {
        comp.disconnect(handlerId);
      });
    });
  }

  async initShutdownModeCombo(settings, comp) {
    const model = new Gtk.StringList();
    const actionIds = [];
    try {
      for await (const action of supportedActions()) {
        model.append(actionLabel(action));
        actionIds.push(ACTIONS[action]);
      }
    } catch (err) {
      console.error(err);
    }
    comp.model = model;
    const updateComboRow = () => {
      const actionId =
        ACTIONS[mapLegacyAction(settings.get_string('shutdown-mode-value'))];
      const index = actionIds.indexOf(actionId);
      if (index >= 0) comp.selected = index;
    };
    comp.connect('notify::selected', () => {
      const actionId = actionIds[comp.selected];
      const action = Object.entries(ACTIONS).find(
        ([_, id]) => id === actionId
      )[0];
      if (action) settings.set_string('shutdown-mode-value', action);
    });
    const comboHandlerId = settings.connect(
      'changed::shutdown-mode-value',
      () => updateComboRow()
    );
    comp.connect('destroy', () => settings.disconnect(comboHandlerId));
    updateComboRow();
  }

  initPage(pageName, builder, settings) {
    if (pageName in templateComponents) {
      for (const [baseName, component] of Object.entries(
        templateComponents[pageName]
      )) {
        const baseId = baseName.replaceAll('-', '_');
        const settingsName = `${baseName}-value`;
        const compId = `${baseId}_${component}`;
        const comp = builder.get_object(compId);
        if (!comp) {
          throw new Error(`Component not found in template: ${compId}`);
        }
        if (compId === 'shutdown_mode_combo') {
          this.initShutdownModeCombo(settings, comp);
        } else {
          settings.bind(
            settingsName,
            comp,
            {
              adjustment: 'value',
              switch: 'active',
              textbuffer: 'text',
              buffer: 'text',
            }[component],
            Gio.SettingsBindFlags.DEFAULT
          );
        }

        if (
          [
            'show_wake_slider_switch',
            'show_wake_absolute_timer_switch',
          ].includes(compId)
        )
          this.switchDependsOnSetting(comp, settings, 'show-wake-items-value');
      }
    }
  }

  switchDependsOnSetting(comp, settings, settingsName) {
    const update = () => {
      const active = settings.get_boolean(settingsName);
      comp.sensitive = active;
      const row = comp.get_parent().get_parent();
      row.sensitive = active;
    };
    const handlerId = settings.connect(`changed::${settingsName}`, () =>
      update()
    );
    comp.connect('destroy', () => settings.disconnect(handlerId));
    update();
  }

  initCheckPage(builder) {
    // Check command textbuffer
    const checkCommandBuffer = builder.get_object('check_command_textbuffer');
    const commentTag = new Gtk.TextTag({ foreground: 'grey' });
    checkCommandBuffer.get_tag_table().add(commentTag);
    checkCommandBuffer.connect('changed', () => {
      const b = checkCommandBuffer;
      b.remove_all_tags(b.get_start_iter(), b.get_end_iter());
      let anchor = b.get_start_iter();
      while (!anchor.is_end()) {
        const [ok, start] = anchor.forward_search(
          '#',
          Gtk.TextSearchFlags.TEXT_ONLY,
          null
        );
        if (!ok) break;
        anchor = start.copy();
        const m = anchor.copy();
        if (!m.starts_line() && m.backward_char() && m.get_char() === '\\') {
          anchor.forward_char();
          continue;
        } else anchor.forward_to_line_end();
        b.apply_tag(commentTag, start, anchor);
        anchor.forward_char();
      }
    });
  }

  initInstallPage(builder, installerScriptPath, install, idle) {
    // install log textbuffer updates
    const logTextBuffer = builder.get_object('install_log_textbuffer');
    const scrollAdj = builder.get_object('installer_scrollbar_adjustment');
    const errorTag = new Gtk.TextTag({ foreground: 'red' });
    const successTag = new Gtk.TextTag({ foreground: 'green' });
    const table = logTextBuffer.get_tag_table();
    table.add(errorTag);
    table.add(successTag);

    const installSwitch = builder.get_object('install_policy_switch');
    installSwitch.set_active(install.checkInstalled());
    installSwitch.connect('notify::active', () =>
      install.installAction(
        installerScriptPath,
        installSwitch.get_active() ? 'install' : 'uninstall',
        async message => {
          await idle.guiIdle();
          // Format log lines
          message.split('\n').forEach(line => {
            line = ['[', '#'].includes(line[0]) ? line : ` ${line}`;
            const b = logTextBuffer;
            b.insert(b.get_end_iter(), `${line}\n`, -1);
            const end = b.get_end_iter();
            const start = end.copy();
            if (start.backward_line()) {
              if (line.startsWith('# ')) {
                b.apply_tag(errorTag, start, end);
              } else if (line.endsWith('🟢')) {
                b.apply_tag(successTag, start, end);
              }
            }
          });
          await idle.guiIdle();
          scrollAdj.set_value(1000000);
        }
      )
    );
    // Clear install log
    logTextBuffer.set_text('', -1);
  }
}
