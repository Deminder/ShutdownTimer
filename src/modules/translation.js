// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

/**
 * The import paths for translations differ for `extension.js` and `prefs.js`.
 * https://gjs.guide/extensions/upgrading/gnome-shell-45.html#esm
 *
 * This module provides shared access to translations.
 * It is assumed that the gettext-domain is already bound.
 */
const domain = 'ShutdownTimer';

/**
 * Translate `str` using the extension's gettext domain
 *
 * @param {string} str - the string to translated
 *
 * @returns {string} the translated string
 */
export function gettext(str) {
  return GLib.dgettext(domain, str);
}

/**
 *  Translate `str` and choose plural form using the extension's
 *  gettext domain
 *
 * @param {string} str - the string to translate
 * @param {string} strPlural - the plural form of the string
 * @param {number} n - the quantity for which translation is needed
 *
 * @returns {string} the translated string
 */
export function ngettext(str, strPlural, n) {
  return GLib.dngettext(domain, str, strPlural, n);
}

/**
 * Translate `str` in the context of `context` using the extension's
 * gettext domain
 *
 *  @param {string} context - context to disambiguate `str`
 *  @param {string} str - the string to translate
 *
 * @returns {string} the translated string
 */
export function pgettext(context, str) {
  return GLib.dpgettext2(domain, context, str);
}
