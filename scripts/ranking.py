#!/usr/bin/env python3

import requests
import os.path
import json
import sys
import re


def fetch_json(s, params):
    return s.get('https://extensions.gnome.org/extension-query/', params=params).json()


def fetch_pages(sort='downloads', version='40.3'):
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

    for i, e in enumerate(extensions):
        if re.match('.*Shutdown.*', e['name'] + " " + e['description'], re.IGNORECASE | re.DOTALL):
            print(i, e['creator'], e['uuid'],
                  '[old]' if '40' not in e['shell_version_map'] else '')
    print(len(extensions), '[last]')
