import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Add an external indicator after an existing indicator and above an existing indicator item.
 */
export function addExternalIndicator(
  tracker,
  indicator,
  after = '_system',
  above = '_backgroundApps',
  colSpan
) {
  const qs = Main.panel.statusArea.quickSettings;
  const indicatorItems = indicator.quickSettingsItems;
  const aboveIndicator = qs[above];
  if (aboveIndicator === undefined) {
    if ('_addItems' in qs) {
      // 45.beta.1: _setupIndicators is not done
      manager.overrideMethod(qs, '_addItems', originalMethod => (items, col) => {
        if (Object.is(items, qs[above].quickSettingsItems)) {
          manager.restoreMethod(qs, '_addItems');
          // Insert after: insert_child_above(a,b): inserts 'a' after 'b'
          qs._indicators.insert_child_above(indicator, qs[after]);
          // Insert above
          originalMethod.call(qs, indicatorItems, colSpan);
        }
        originalMethod.call(qs, items, col);
      });
    } else {
      // 45.rc: _setupIndicators is not done
      const qsm = qs.menu;
      manager.overrideMethod(
        qsm,
        '_completeAddItem',
        originalMethod => (item, col) => {
          const firstAboveItem = qs[above]?.quickSettingsItems.at(-1);
          if (Object.is(firstAboveItem, item)) {
            manager.restoreMethod(qsm, '_completeAddItem');
            // Insert after: insert_child_above(a,b): inserts 'a' after 'b'
            qs._indicators.insert_child_above(indicator, qs[after]);
            // Insert above
            indicatorItems.forEach(newItem =>
              qsm.insertItemBefore(newItem, item, colSpan)
            );
          }
          originalMethod.call(qsm, item, col);
        }
      );
    }
  } else if ('_addItems' in qs) {
    // 45.beta.1: _setupIndicators is done
    // Insert after: insert_child_above(a,b): inserts 'a' after 'b'
    qs._indicators.insert_child_above(indicator, qs[after]);
    // Insert above
    qs._addItems(indicatorItems, colSpan);
    const firstAboveItem = aboveIndicator.quickSettingsItems.at(-1);
    indicatorItems.forEach(item => {
      qs.menu._grid.remove_child(item);
      qs.menu._grid.insert_child_below(
        item,
        firstAboveItem
      );
    });
  } else {
    // 45.rc: _setupIndicators is done
    // Insert after
    qs._indicators.insert_child_above(indicator, qs[after]);

    // Insert above
    const firstAboveItem = aboveIndicator.quickSettingsItems.at(-1);
    qs._addItemsBefore(indicatorItems, firstAboveItem, colSpan);
  }
}
