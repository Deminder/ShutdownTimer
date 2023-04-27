#!/usr/bin/env python3

# SPDX-FileCopyrightText: 2023 Deminder <tremminder@gmail.com>
# SPDX-License-Identifier: GPL-3.0-or-later

import requests
import os.path
import json
import sys
import re


def fetch_json(s, params):
    return s.get('https://extensions.gnome.org/extension-query/', params=params).json()


def fetch_pages(sort='downloads', version='44'):
    p = {'page': 1}
    if sort is not None:
        p['sort'] = sort
    if version is not None:
        p['shell_version'] = version

    s = requests.Session()
    print('page', 0)
    first_page = fetch_json(s, p)
    extensions = first_page['extensions']
    for n in range(1, first_page['numpages']):
        print('page', n)
        p['page'] = n + 1
        page = fetch_json(s, p)
        extensions += page['extensions']

    return extensions


if __name__ == '__main__':
    REFETCH = False
    if len(sys.argv) > 1:
        REFETCH = sys.argv[1] == 'fetch'
    FETCH_CACHE = 'ranking-downloads.json'
    if REFETCH or not os.path.exists(FETCH_CACHE):
        extensions = fetch_pages(version=None)
        with open(FETCH_CACHE, 'w') as f:
            json.dump(extensions, f)
    else:
        with open(FETCH_CACHE, 'r') as f:
            extensions = json.load(f)

    new_only = True
    downloads_dist = []
    annotations = []
    new_count = 0
    for i, e in enumerate(extensions):
        versions = e['shell_version_map']
        is_new = any(int(v.split('.')[0]) >= 43 for v in versions.keys())
        new_count += is_new
        if new_only and not is_new:
            continue
        dlds = int(e['downloads'])
        index = new_count if new_only else i
        highlight = e['creator'] == 'Deminder'
        if highlight:
            annotations.append([f'{e["name"]} ({index})', [index, dlds]])
        downloads_dist.append(dlds)
        if highlight or re.match('.*(Shutdown|OSD).*', e['name'] + " " + e['description'], re.IGNORECASE | re.DOTALL):
            print(index, ('*' if highlight else '') + e['creator'], e['uuid'],
                  '' if is_new else '[old]', dlds)
    print(new_count if new_only else len(extensions), '[last]')
    import numpy as np
    import matplotlib.pyplot as plt
    d = np.array(downloads_dist)
    # plt.plot(d[(d < 10 ** 6) * (d > 1000)])
    plt.plot(d)
    plt.title('Extension Downloads')
    plt.yscale('log')
    for i, (s, xy) in enumerate(annotations):
        sign = 1 if i%2 == 0 else -3
        plt.annotate(s, xy=xy, xytext=(sign*20, sign*20), textcoords='offset points',  arrowprops=dict(arrowstyle='->'))
    plt.grid(True)
    plt.show()
