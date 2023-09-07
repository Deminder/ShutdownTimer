// SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  assert,
  assertEquals,
  permutations,
  product,
  describe,
  it,
  range,
  logOriginExcludes,
} from './test-base.js';
import { InjectionTracker } from '../src/modules/injection.js';

await describe(
  'injection tracker',
  it('should clear all', () => {
    const tracker1 = new InjectionTracker();
    const tracker2 = new InjectionTracker();
    const myobj = {
      val: 'orig',
      get prop() {
        return `${this.val}prop`;
      },
    };
    tracker1.clearAll();
    assertEquals(myobj.prop, 'origprop', 'should be orig value');
    tracker1.injectProperty(myobj, 'prop', 't1prop');
    assertEquals(myobj.prop, 't1prop');
    const inj = tracker2.injectProperty(myobj, 'prop', 't2prop');
    assertEquals(myobj.prop, 't2prop');
    assertEquals(inj.previous, 't1prop');
    assertEquals(inj.original, 'origprop');
    assertEquals(tracker1.localInjections.length, 1);
    assertEquals(tracker2.localInjections.length, 1);
    tracker2.clearAll();
    assertEquals(tracker2.localInjections.length, 0);
    assertEquals(myobj.prop, 't1prop');
    tracker2.injectProperty(myobj, 'prop', 't2prop2');
    assertEquals(myobj.prop, 't2prop2');
    tracker1.clearAll();
    assertEquals(myobj.prop, 't2prop2', 'should only clear local injections');
    tracker2.clearAll();
    assertEquals(myobj.prop, 'origprop', 'should restore original');
    assertEquals(tracker1.localInjections.length, 0);
    assertEquals(tracker2.localInjections.length, 0);
  }),

  it('should inject properties', () => {
    const tracker1 = new InjectionTracker();
    const tracker2 = new InjectionTracker();
    const tracker3 = new InjectionTracker();
    const myobj = {
      _addItems(val) {
        log(`[orig] ${val}\n`);
      },
    };

    const injection = tracker1.injectProperty(myobj, '_addItems', val => {
      log(`[i1] ${val}`);
      if (val === 'test4') {
        injection.previous.call(myobj, ' -- from [i1]');
        log('[i1] clear()');
        injection.clear();
      }
      injection.previous.call(myobj, val);
    });

    const injection2 = tracker2.injectProperty(myobj, '_addItems', val => {
      log(`[i2] ${val}`);
      if (val === 'test2') {
        log('[i2] clear()');
        injection2.clear();
        injection2.previous.call(myobj, ' -- from [i2]');
      }
      injection2.previous.call(myobj, val);
    });

    const injection3 = tracker3.injectProperty(myobj, '_addItems', val => {
      if (val === 'test3') {
        log(`[i3] ${val}`);
      }
      injection3.previous.call(myobj, val);
    });
    assertEquals(
      injection3.count,
      3,
      'injection3 should have 3 previous functions'
    );
    injection3.original.call(myobj, 'origorig');

    myobj._addItems('test');
    myobj._addItems('test2');
    assertEquals(
      injection3.count,
      2,
      'injection3 should have 2 previous functions'
    );
    const injection4 = tracker1.injectProperty(myobj, '_addItems', val => {
      if (val === 'test') {
        log(`[i3] ${val}`);
      }
      injection4.previous.call(myobj, val);
    });
    myobj._addItems('test2');
    myobj._addItems('test');
    myobj._addItems('test3');
    myobj._addItems('test');
    myobj._addItems('test4');
    assertEquals(
      injection3.count,
      1,
      'injection3 should have 1 previous function'
    );
    myobj._addItems('test4');
    myobj._addItems('test');
    assertEquals(
      injection3.count,
      1,
      'injection3 should have 1 previous function'
    );
    injection3.clear();
    assertEquals(
      injection3.count,
      1,
      'injection3 should have 1 previous function due to injection4'
    );
    injection4.clear();
    assertEquals(
      injection3.count,
      0,
      'injection3 should have no previous function'
    );
    assert(
      myobj.__injectionHistories === undefined,
      'should have cleared injection histories'
    );
    log('');
    myobj._addItems('test5');
    injection3.previous.call(myobj, 'only orig');
    injection3.original.call(myobj, 'only orig');
  }),

  it('should not fail for arbitrary injection combinations', () => {
    logOriginExcludes.set('1', /\/modules\/injection\.js:\d+:\d+$/);
    const myobj = {
      _addItems: i => `orig${i}`,
    };
    const injectionStateStr = (inj, message = '') => {
      const h = myobj.__injectionHistories._addItems;
      const c = bb => bb.map(b => (b ? 'x' : '.')).join(' ');
      return [
        message,
        `hist ${c(h.map(v => v === undefined))}`,
        `prev ${c(h.map(d => Object.is(inj.previous, d?.value)))}`,
        `orig ${c(h.map(d => Object.is(inj.original, d?.value)))}`,
      ].join('\n');
    };
    const injectionHandlers = {
      t1: (inj, i) => {
        log(injectionStateStr(inj, 't1'));
        return inj.previous.call(myobj, i);
      },
      t2: (inj, i) => {
        if (i >= 4) {
          inj.clear();
        } else {
          inj.original.call(myobj, i);
        }
        assert(
          i <= 5,
          `t2 should be cleared after 5 (since 4 may be skipped by t3) (i: ${i})`
        );
        return inj.previous.call(myobj, i);
      },
      t3: (inj, i) => {
        if (i === 4) {
          inj.clear();
          return inj.original.call(myobj, i);
        } else {
          assert(i < 4, `t3 should be cleared after 4 (i: ${i})`);
          return inj.previous.call(myobj, i);
        }
      },
      t4: (inj, i) => {
        if (i === 5) {
          inj.original.call(myobj, i);
          inj.clear();
        }
        assert(i <= 5, 't4 should be cleared after 5');
        return inj.previous.call(myobj, i);
      },
      t5: (inj, i) => {
        const val = inj.previous.call(myobj, i);
        if (i === 6) inj.clear();
        assert(i <= 6, 't5 should be cleared after 6');
        return val;
      },
    };
    const checkCall = i => {
      const val = myobj._addItems(i);
      assert(typeof val === 'string', `${val} should be a string (i: ${i})`);
    };

    const names = Object.keys(injectionHandlers);

    for (const k of range(names.length+1)) {
      for (let trackerOrder of permutations(names, k)) {
        try {
          const trackers = Object.fromEntries(
            trackerOrder.map(name => [name, new InjectionTracker()])
          );
          for (const trackerName of trackerOrder) {
            const inj = trackers[trackerName].injectProperty(
              myobj,
              '_addItems',
              ii => injectionHandlers[trackerName](inj, ii)
            );
            checkCall(-1);
          }
          for (const i of range(10)) {
            checkCall(i);
          }
          for (const tracker of Object.values(trackers)) {
            tracker.clearAll();
            checkCall(-1);
          }
          assert(
            !('__injectionHistories' in myobj),
            'should clear injection history'
          );
        } catch (err) {
          log('trackers', trackerOrder.join(', '));
          throw err;
        }
      }
    }
  })
);
