// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later
import { logDebug } from './util.js';

/**
 * The InjectionTracker helps revert object property injections 'out of order'
 * by keeping track of the injection history.
 * This is useful when overriding the same method from mulitple extensions,
 * for instance, `Main.panel.statusArea.quickSettings._addItems`.
 *
 * The InjectionManager does not work when multiple extensions override the same method.
 * Its `restoreMethod` only restores correctly if it is called in reverse order to `overrideMethod`.
 *
 */
export class InjectionTracker {
  localInjections = [];

  /**
   * Inject a property into an object.
   *
   * To revert the injection call `injection.clear()`.
   *
   * @param {object} obj the target object
   * @param {string} prop the property name
   * @param {any} value the new property value
   * @param {boolean} isPropertyDescriptor whether the value is a property descriptor
   *
   * @returns {object} an injection object
   * provding `injection.original` and `injection.previous` property values
   */
  injectProperty(obj, prop, value, isPropertyDescriptor) {
    let propertyDescriptor = Object.getOwnPropertyDescriptor(obj, prop);
    if (!propertyDescriptor) {
      if (prop in obj) {
        propertyDescriptor = {
          value: obj[prop],
          writable: true,
          configurable: true,
        };
      } else {
        throw new Error(
          `Injection target object does not have a '${prop}' property!`
        );
      }
    }
    // Keep history; mutated by each injection
    const histories = obj.__injectionHistories ?? {};
    const history = histories[prop] ?? [];
    // Push old property descriptor to history
    history.push(propertyDescriptor);
    histories[prop] = history;
    obj.__injectionHistories = histories;

    const injectionId = history.length;
    logDebug('[new] injectionid', injectionId);

    // Override value
    Object.defineProperty(
      obj,
      prop,
      isPropertyDescriptor
        ? value
        : { value, writable: false, configurable: true }
    );

    const localInjectionId = this.localInjections.length;
    const injection = createInjection(obj, prop, history, injectionId, () => {
      // Remove from local injections
      this.localInjections[localInjectionId] = undefined;
      const pruneIndex =
        this.localInjections.length -
        1 -
        [...this.localInjections].reverse().findIndex(inj => inj !== undefined);
      if (pruneIndex === this.localInjections.length) {
        logDebug('[local-cleanclear]');
        this.localInjections = [];
      } else {
        logDebug('[local-nocleanclear]');
        this.localInjections = this.localInjections.slice(0, pruneIndex);
      }
    });
    this.localInjections.push(injection);
    return injection;
  }

  /**
   * Clear all injections made by this instance.
   */
  clearAll() {
    this.localInjections
      .filter(inj => inj !== undefined)
      .forEach(inj => inj.clear());
  }
}

function createInjection(obj, prop, history, injectionId, clearHook) {
  let reverted = false;
  const readDescriptorValue = descriptor =>
    'get' in descriptor ? descriptor.get.call(obj) : descriptor.value;
  return {
    /**
     * Read the original property value before any injections.
     */
    get original() {
      // Using h instead history to remain valid after `clear()`
      const h = obj.__injectionHistories?.[prop];
      return readDescriptorValue(
        h?.length ? h[0] : Object.getOwnPropertyDescriptor(obj, prop)
      );
    },

    /**
     * Read the previous property value from the injection history.
     *
     * Valid after `clear()` as long as no new injection occurs.
     */
    get previous() {
      return history.length
        ? readDescriptorValue(
            injectionId > history.length
              ? Object.getOwnPropertyDescriptor(obj, prop)
              : popPropertyDescriptorFromHistory(
                  // previous history
                  history.slice(0, injectionId)
                )
          )
        : this.original;
    },

    /**
     * Clear the injection from the injection history.
     */
    clear() {
      if (!reverted) {
        reverted = true;
        clearHook();

        // Remove from global injections
        if (injectionId >= history.length) {
          logDebug(
            '[remclear] injectionID',
            injectionId,
            'historylen',
            history.length
          );
          // Restore property of obj
          Object.defineProperty(
            obj,
            prop,
            popPropertyDescriptorFromHistory(history)
          );
          // Cleanup empty history
          if (history.length === 0) {
            logDebug('[cleanclear]');
            delete obj.__injectionHistories[prop];

            // Cleanup empty history store
            if (Object.keys(obj.__injectionHistories).length === 0) {
              delete obj.__injectionHistories;
            }
          } else {
            logDebug('[nocleanclear] history.length', history.length);
          }
        } else {
          logDebug(
            '[setclear] injectionID',
            injectionId,
            'historylen',
            history.length
          );
          // Clear injection from history
          history[injectionId] = undefined;
        }
      }
    },

    /**
     * Count of previous injections. Is 1 if there is only this injection.
     */
    get count() {
      return history.slice(0, injectionId).filter(i => i !== undefined).length;
    },
  };
}

function popPropertyDescriptorFromHistory(history) {
  let propertyDescriptor;
  do {
    propertyDescriptor = history.pop();
  } while (history.length && propertyDescriptor === undefined);
  return propertyDescriptor;
}
