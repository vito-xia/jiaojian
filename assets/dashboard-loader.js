(() => {
  'use strict';

  const data = window.__JIAOJIAN_DASHBOARD__ || (window.__JIAOJIAN_DASHBOARD__ = {});
  const registry = window.__JIAOJIAN_CHUNKS__ || (window.__JIAOJIAN_CHUNKS__ = Object.create(null));
  const pending = new Map();
  const loaded = new Set();
  const paths = Object.freeze({
    controls: 'dashboard_controls.js',
    delivery: 'dashboard_delivery.js',
    'platform-douyin': 'dashboard_platform_douyin.js',
    'platform-taobao': 'dashboard_platform_taobao.js',
    'platform-jd': 'dashboard_platform_jd.js',
    'platform-kuaishou': 'dashboard_platform_kuaishou.js',
    'drawer-douyin': 'dashboard_drawer_douyin.js',
    'drawer-taobao': 'dashboard_drawer_taobao.js',
    'drawer-jd': 'dashboard_drawer_jd.js',
    'drawer-kuaishou': 'dashboard_drawer_kuaishou.js'
  });
  const mergeMaps = new Set(['platforms', 'trends', 'branch_top5_data']);

  function mergePayload(payload) {
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (mergeMaps.has(key)) {
        const current = data[key] && typeof data[key] === 'object' ? data[key] : {};
        data[key] = { ...current, ...(value || {}) };
      } else {
        data[key] = value;
      }
    });
    return data;
  }

  window.__JIAOJIAN_REGISTER_CHUNK__ = (name, payload) => {
    registry[name] = payload;
  };

  function assetVersion() {
    return String(data.meta?.asset_version || data.meta?.as_of || '1').replace(/[^0-9A-Za-z_-]/g, '');
  }

  function load(name) {
    if (!paths[name]) return Promise.reject(new Error('Unknown dashboard data chunk: ' + name));
    if (loaded.has(name)) return Promise.resolve(data);
    if (registry[name]) {
      mergePayload(registry[name]);
      loaded.add(name);
      return Promise.resolve(data);
    }
    if (pending.has(name)) return pending.get(name);

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = 'data/' + paths[name] + '?v=' + encodeURIComponent(assetVersion());
      script.onload = () => {
        const payload = registry[name];
        if (!payload) {
          reject(new Error('Dashboard data chunk did not register: ' + name));
          return;
        }
        mergePayload(payload);
        loaded.add(name);
        resolve(data);
      };
      script.onerror = () => reject(new Error('Dashboard data chunk failed to load: ' + name));
      document.head.appendChild(script);
    }).finally(() => pending.delete(name));

    pending.set(name, promise);
    return promise;
  }

  window.__JIAOJIAN_DATA_LOADER__ = {
    data,
    load,
    has: name => loaded.has(name) || Boolean(registry[name])
  };
})();