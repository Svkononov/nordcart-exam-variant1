import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const artifacts = ['config/runtime.json', 'config/api-contract.json', 'config/messages.ru.json', 'data/checkout-schema.json', 'data/placeholders.json', 'data/catalog.json'];
const original = new Map(artifacts.map(p => [p, JSON.parse(read(p))]));
const runtime = original.get('config/runtime.json');
const base = new URL(runtime.api.baseUrl);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = async dom => { for (let i = 0; i < 4; i++) await wait(0); return dom; };

async function boot(path, { queue = [], storage = {}, artifactFailure = null, artifactOverrides = {}, confirmResult = false } = {}) {
  const attempts = [], requests = [], forbidden = [], pending = [...queue], unhandled = [], deferred = [];
  const dom = new JSDOM(read(path.slice(1)), { url: `http://local${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  for (const [key, value] of Object.entries(storage)) dom.window.localStorage.setItem(key, value);
  const localOrigin = dom.window.location.origin;
  dom.window.confirm = () => confirmResult;
  dom.window.addEventListener('unhandledrejection', e => { unhandled.push(e.reason); e.preventDefault(); });
  dom.window.fetch = async (input, options = {}) => {
    const u = new URL(String(input), dom.window.location.href);
    attempts.push(u.href);
    const key = u.pathname.replace(/^\//, '');
    const isLocalArtifact = u.origin === localOrigin && artifacts.includes(key);
    if (artifacts.includes(key)) {
      if (!isLocalArtifact) { forbidden.push(u.href); throw Error('foreign artifact'); }
      if (artifactFailure === key) return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => artifactOverrides[key] ?? original.get(key) };
    }
    const apiPath = base.pathname.replace(/\/$/, '');
    if (u.origin !== base.origin || !u.pathname.startsWith(`${apiPath}/`)) {
      forbidden.push(u.href); throw Error('blocked external request');
    }
    const request = { url: u.href, method: (options.method || 'GET').toUpperCase(), headers: options.headers || {}, body: options.body };
    requests.push(request);
    const response = pending.shift();
    if (response?.type === 'deferred') return await new Promise(resolve => deferred.push(() => resolve({ ok: true, json: async () => response.body ?? [] })));
    if (response?.type === 'timeout') throw Error('timeout');
    if (response?.type === 'bad') return { ok: false, json: async () => ({}) };
    if (response?.type === 'invalid') return { ok: true, json: async () => { throw Error('invalid json'); } };
    return { ok: true, json: async () => response?.body ?? [] };
  };
  dom.window.eval(read('app.js'));
  await settle(dom);
  return { dom, attempts, requests, forbidden, unhandled, release: () => deferred.splice(0).forEach(resolve => resolve()) };
}

const dispatch = (dom, node, type) => node.dispatchEvent(new dom.window.Event(type, { bubbles: true, cancelable: true }));
const click = (dom, selector) => { const n = dom.window.document.querySelector(selector); assert.ok(n, selector); n.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); return n; };
const submit = (dom, selector) => { const n = dom.window.document.querySelector(selector); assert.ok(n, selector); dispatch(dom, n, 'submit'); return n; };
const cards = dom => [...dom.window.document.querySelectorAll('#products .card')];
const cardNames = dom => cards(dom).map(x => x.querySelector('h3')?.textContent);
const cartValue = dom => JSON.parse(dom.window.localStorage.getItem('nordcart-cart'));
const goodSet = [
  { id: 1, name: 'Alpha', main_category: 'coffee', actual_price: 30, discount_price: null, rating: 2, image_url: 'https://images.unsplash.com/alpha' },
  { id: 2, name: 'Bravo', main_category: 'tea', actual_price: 20, discount_price: 5, rating: 5, image_url: 'https://images.unsplash.com/bravo' },
  { id: 3, name: 'Charlie', main_category: 'coffee', actual_price: 10, discount_price: 8, rating: 3, image_url: 'https://images.unsplash.com/charlie' }
];
const api = body => ({ body: structuredClone(body) });

test('catalog search, autocomplete, filters, all configured sorts, and add/cartCount', async () => {
  const { dom, forbidden } = await boot('/index.html', { queue: [api(goodSet), api(['Bravo']), api([goodSet[1]])] });
  const d = dom.window.document;
  assert.ok(d.querySelector('#products.products')); assert.ok(d.querySelector('#searchForm')); assert.ok(d.querySelector('#filters')); assert.ok(d.querySelector('#sort'));
  const sort = d.querySelector('#sort');
  for (const value of runtime.data.sortOptions) {
    sort.value = value; dispatch(dom, sort, 'change');
    const expected = value === 'price_asc' ? ['Bravo', 'Charlie', 'Alpha'] : value === 'price_desc' ? ['Alpha', 'Charlie', 'Bravo'] : value === 'rating_asc' ? ['Alpha', 'Charlie', 'Bravo'] : ['Bravo', 'Charlie', 'Alpha'];
    assert.deepEqual(cardNames(dom), expected, value);
  }
  const search = d.querySelector('#search'); search.value = 'bra'; dispatch(dom, search, 'input'); await settle(dom);
  assert.equal(d.querySelector('[data-suggest]').textContent, 'Bravo'); click(dom, '[data-suggest]'); assert.equal(search.value, 'Bravo');
  submit(dom, '#searchForm'); await settle(dom); assert.deepEqual(cardNames(dom), ['Bravo']);
  for (const [control, value, expected] of [['category', 'coffee', ['Alpha', 'Charlie']], ['from', '25', ['Alpha']], ['to', '9', ['Bravo', 'Charlie']], ['discount', true, ['Bravo', 'Charlie']]]) {
    const b = await boot('/index.html', { queue: [api(goodSet)] }); const bd = b.dom.window.document;
    if (control === 'category') { const c = [...bd.querySelectorAll('#categories input')].find(x => x.value === value); assert.ok(c); c.checked = true; }
    if (control === 'from') bd.querySelector('#priceFrom').value = value;
    if (control === 'to') bd.querySelector('#priceTo').value = value;
    if (control === 'discount') bd.querySelector('#discountOnly').checked = true;
    submit(b.dom, '#filters'); assert.deepEqual(cardNames(b.dom), expected, control); assert.ok(bd.querySelector('#sort')); assert.ok(bd.querySelector('#searchForm')); assert.equal(b.forbidden.length, 0);
  }
  click(dom, '[data-add="2"]'); assert.deepEqual(cartValue(dom), [2]); assert.equal(d.querySelector('#cartCount').textContent, '1'); assert.equal(forbidden.length, 0);
});

test('malformed and oversized cart recovery, decrement/remove-all, row quantity and invalid id', async () => {
  const malformed = await boot('/cart.html', { storage: { 'nordcart-cart': 'not-json' }, queue: [{ type: 'bad' }] });
  assert.deepEqual(cartValue(malformed.dom), []); assert.equal(malformed.dom.window.document.querySelector('#notice')?.textContent ?? '', ''); assert.ok([...malformed.dom.window.document.querySelectorAll('#orderForm input,#orderForm select,#orderForm textarea,#orderForm button')].every(x => !x.disabled));
  const key = runtime.cache.storageKey; const cache = JSON.stringify({ schemaVersion: runtime.cache.schemaVersion, savedAt: Date.now(), goods: goodSet });
  const b = await boot('/cart.html', { storage: { 'nordcart-cart': JSON.stringify([...Array(150)].map(() => 2)), [key]: cache }, queue: [{ type: 'bad' }] }); const d = b.dom.window.document;
  assert.equal(cartValue(b.dom).length, 100); assert.equal(d.querySelectorAll('#cartItems .cart-row').length, 1); assert.match(d.querySelector('#cartItems .cart-row button[data-decrement]').textContent, /\(100\)/);
  click(b.dom, '[data-decrement="2"]'); assert.equal(cartValue(b.dom).length, 99); assert.match(d.querySelector('#cartItems .cart-row button[data-decrement]').textContent, /\(99\)/);
  const invalid = d.createElement('button'); invalid.dataset.decrement = '999'; d.body.append(invalid); click(b.dom, 'button[data-decrement="999"]'); assert.equal(cartValue(b.dom).length, 99);
  click(b.dom, '[data-remove="2"]'); assert.deepEqual(cartValue(b.dom), []); assert.equal(d.querySelectorAll('#cartItems .cart-row').length, 0); assert.equal(b.requests.some(x => x.method === 'POST'), false); assert.equal(b.forbidden.length, 0);
});

function fillCheckout(dom) {
  const form = dom.window.document.querySelector('#orderForm'); assert.ok(form);
  for (const el of form.elements) {
    if (el.name === 'subscribe') el.checked = true;
    else if (el.type !== 'submit') el.value = el.type === 'date' ? '2026-06-01' : el.name === 'delivery_interval' ? '08:00-12:00' : (el.type === 'email' ? 'buyer@example.test' : el.type === 'tel' ? '+79990000000' : 'Valid value');
  }
  return form;
}

test('failed GET displays the configured catalog snapshot and successful online checkout submits exact payload', async () => {
  const retry = await boot('/index.html', { queue: [{ type: 'bad' }, api(goodSet)] }); const rd = retry.dom.window.document;
  assert.deepEqual(cardNames(retry.dom), original.get('data/catalog.json').map(x => x.name)); assert.equal(retry.requests.filter(x => x.method === 'GET').length, 1); assert.equal(retry.dom.window.document.querySelector('#notice')?.textContent ?? '', ''); assert.equal(retry.forbidden.length, 0);
  const token = 'test-token'; const b = await boot('/cart.html', { storage: { 'nordcart-api-key': token, 'nordcart-cart': '[2]' }, queue: [api(goodSet), api({ ok: true })] }); const d = b.dom.window.document;
  assert.ok([...d.querySelectorAll('#orderForm input,#orderForm select,#orderForm textarea,#orderForm button')].every(x => !x.disabled));
  fillCheckout(b.dom); submit(b.dom, '#orderForm'); await settle(b.dom); const post = b.requests.find(x => x.method === 'POST'); assert.ok(post); const u = new URL(post.url);
  assert.equal(u.origin, base.origin); assert.equal(u.pathname, `${base.pathname}/orders`); assert.equal(u.search, ''); assert.equal(post.headers.Authorization, `Bearer ${token}`); assert.equal(post.headers['Content-Type'], 'application/json');
  const payload = JSON.parse(post.body); const expected = original.get('config/api-contract.json').orderPayload.fields.map(x => x.name).sort(); assert.deepEqual(Object.keys(payload).sort(), [...expected, 'good_ids'].sort());
  assert.deepEqual(payload, { full_name: 'Valid value', email: 'buyer@example.test', phone: '+79990000000', subscribe: true, delivery_address: 'Valid value', delivery_date: '2026-06-01', delivery_interval: '08:00-12:00', comment: 'Valid value', good_ids: [2] });
  assert.equal(typeof payload.full_name, 'string'); assert.equal(typeof payload.email, 'string'); assert.equal(typeof payload.phone, 'string'); assert.equal(typeof payload.delivery_address, 'string'); assert.equal(typeof payload.delivery_date, 'string'); assert.equal(typeof payload.delivery_interval, 'string'); assert.equal(typeof payload.comment, 'string'); assert.equal(typeof payload.subscribe, 'boolean'); assert.ok(Array.isArray(payload.good_ids)); assert.equal(d.defaultView.localStorage.getItem('nordcart-cart'), '[]'); assert.equal(b.forbidden.length, 0);
});

test('snapshot catalog keeps checkout interactive and reports validation and delivery failures', async () => {
  const b = await boot('/cart.html', { storage: { 'nordcart-cart': '[1]' }, queue: [{ type: 'bad' }, { type: 'bad' }] }); const d = b.dom.window.document;
  const form = d.querySelector('#orderForm'); assert.ok(form); assert.ok([...form.querySelectorAll('input,select,textarea,button')].every(x => !x.disabled));
  submit(b.dom, '#orderForm'); await settle(b.dom); assert.match(d.querySelector('#orderErrors').textContent, /Проверьте/); assert.equal(b.requests.some(x => x.method === 'POST'), false);
  fillCheckout(b.dom); submit(b.dom, '#orderForm'); await settle(b.dom); assert.equal(b.requests.filter(x => x.method === 'POST').length, 1); assert.match(d.querySelector('#notice').textContent, /Не удалось оформить заказ/); assert.deepEqual(cartValue(b.dom), [1]); assert.equal(b.forbidden.length, 0);
});

test('non-2xx, timeout, and invalid JSON checkout responses preserve cart', async () => {
  for (const failure of [{ type: 'bad' }, { type: 'timeout' }, { type: 'invalid' }]) {
    const b = await boot('/cart.html', { storage: { 'nordcart-cart': '[1]' }, queue: [api(goodSet), failure] }); const d = b.dom.window.document; fillCheckout(b.dom); submit(b.dom, '#orderForm'); await settle(b.dom);
    assert.deepEqual(cartValue(b.dom), [1], failure.type); assert.ok(b.requests.some(x => x.method === 'POST'), failure.type); assert.equal(b.forbidden.length, 0, failure.type);
  }
});

test('invalid artifacts fail closed and all API failure modes stay same-origin', async () => {
  for (const artifactFailure of artifacts) { const b = await boot('/index.html', { artifactFailure }); assert.equal(b.dom.window.document.querySelector('#products'), null, artifactFailure); assert.equal(b.requests.length, 0, artifactFailure); assert.equal(b.forbidden.length, 0, artifactFailure); }
  for (const type of ['timeout', 'bad', 'invalid']) { const b = await boot('/index.html', { queue: [{ type }] }); assert.equal(b.requests.some(x => x.method === 'POST' || x.method === 'DELETE'), false, type); assert.equal(b.forbidden.length, 0, type); }
  const source = read('app.js'); assert.equal(source.includes('innerHTML'), false); assert.equal(source.includes('api_key='), false);
});

test('cache envelope, snapshot fallback, and no runtime product hardcode', async () => {
  const key = runtime.cache.storageKey;
  const online = await boot('/index.html', { queue: [api(goodSet)] });
  const envelope = JSON.parse(online.dom.window.localStorage.getItem(key));
  assert.deepEqual(envelope.goods, goodSet); assert.equal(envelope.schemaVersion, runtime.cache.schemaVersion); assert.equal(typeof envelope.savedAt, 'number'); assert.ok(envelope.savedAt <= Date.now()); assert.equal(online.forbidden.length, 0);
  const validCache = JSON.stringify({ schemaVersion: runtime.cache.schemaVersion, savedAt: Date.now(), goods: goodSet });
  const cached = await boot('/index.html', { storage: { [key]: validCache }, queue: [{ type: 'bad' }] });
  assert.deepEqual(cardNames(cached.dom), goodSet.map(x => x.name)); assert.equal(cached.dom.window.document.querySelector('#notice')?.textContent ?? '', ''); assert.equal(cached.forbidden.length, 0);
  const now = Date.now();
  const cases = [
    null,
    '{bad json',
    JSON.stringify({ schemaVersion: runtime.cache.schemaVersion, savedAt: now - runtime.cache.ttlMs - 1, goods: goodSet }),
    JSON.stringify({ schemaVersion: runtime.cache.schemaVersion, savedAt: now + 60000, goods: goodSet }),
    JSON.stringify({ schemaVersion: 'wrong', savedAt: now, goods: goodSet }),
    JSON.stringify({ schemaVersion: runtime.cache.schemaVersion, savedAt: now, goods: [{ ...goodSet[0], image_url: 'javascript:alert(1)' }] })
  ];
  const snapshot = original.get('data/catalog.json');
  for (const [index, value] of cases.entries()) {
    const b = await boot('/index.html', { storage: value === null ? {} : { [key]: value }, queue: [{ type: 'bad' }] }); const d = b.dom.window.document;
    assert.deepEqual(cardNames(b.dom), snapshot.map(x => x.name), `cache case ${index}`); assert.equal(d.querySelector('#notice')?.textContent ?? '', ''); assert.equal(b.forbidden.length, 0);
  }
  assert.equal(fs.existsSync(new URL('../data/catalog.json', import.meta.url)), true);
  for (const p of ['config/runtime.json', 'config/api-contract.json', 'config/messages.ru.json']) { const text = read(p).toLowerCase(); assert.equal(/demo-goods|outage|unavailable/.test(text), false, p); }
});

test('account empty/ready/modal/delete/error paths use configured methods and stay handled', async () => {
  const hostile = { id: 'o-1', created_at: '<script>alert(1)</script>', good_ids: [1], delivery_date: '2026-06-02', delivery_interval: '08:00-12:00', full_name: '<img src=x onerror=alert(1)>', phone: '+79990000000', delivery_address: '<b>hostile</b>', comment: '" onmouseover="alert(1)' };
  const loading = await boot('/account.html', { queue: [{ type: 'deferred' }] }); assert.ok(loading.dom.window.document.querySelector('#orders .loading')); assert.equal(loading.unhandled.length, 0); loading.release(); await settle(loading.dom); assert.ok(loading.dom.window.document.querySelector('#orders .empty'));
  const empty = await boot('/account.html', { queue: [api([])] }); assert.ok(empty.dom.window.document.querySelector('#orders .empty')); assert.equal(empty.forbidden.length, 0); assert.equal(empty.unhandled.length, 0);
  const retried = await boot('/account.html', { queue: [{ type: 'bad' }, api([hostile])] }); assert.ok(retried.dom.window.document.querySelector('#orders .error + button')); click(retried.dom, '#orders .error + button'); await settle(retried.dom); assert.equal(retried.dom.window.document.querySelectorAll('#orders .order').length, 1); assert.equal(retried.unhandled.length, 0);
  const exhausted = await boot('/account.html', { queue: [{ type: 'bad' }, { type: 'bad' }, { type: 'bad' }] }); for (let i = 0; i < 2; i++) { assert.ok(exhausted.dom.window.document.querySelector('#orders .error + button')); click(exhausted.dom, '#orders .error + button'); await settle(exhausted.dom); } assert.match(exhausted.dom.window.document.querySelector('#orders').textContent, /исчерпаны/); assert.equal(exhausted.dom.window.document.querySelector('#orders .error + button'), null); assert.equal(exhausted.unhandled.length, 0);
  const ready = await boot('/account.html', { queue: [api([hostile]), api(hostile)] }); const d = ready.dom.window.document;
  assert.equal(d.querySelectorAll('#orders .order').length, 1); const view = d.querySelector('[data-order-view="o-1"]'); view.focus(); view.dispatchEvent(new ready.dom.window.MouseEvent('click', { bubbles: true })); await settle(ready.dom); const modal = d.querySelector('#orderModal');
  assert.ok(modal); assert.equal(modal.querySelector('[role="dialog"]').getAttribute('aria-labelledby'), 'modalTitle'); assert.equal(modal.querySelector('#modalTitle').id, 'modalTitle'); assert.match(modal.textContent, /<script>alert/); assert.match(modal.textContent, /hostile/); assert.equal(modal.querySelectorAll('script').length, 0);
  const close = modal.querySelector('button'); close.click(); assert.equal(d.querySelector('#orderModal'), null); assert.equal(d.activeElement, view); assert.equal(ready.unhandled.length, 0);
  const cancel = await boot('/account.html', { queue: [api([hostile])], confirmResult: false }); click(cancel.dom, '[data-order-delete="o-1"]'); await settle(cancel.dom); assert.equal(cancel.requests.some(x => x.method === 'DELETE'), false); assert.equal(cancel.unhandled.length, 0);
  const removed = await boot('/account.html', { queue: [api([hostile]), api({ ok: true }), api([])], confirmResult: true }); click(removed.dom, '[data-order-delete="o-1"]'); await settle(removed.dom); assert.equal(removed.requests.filter(x => x.method === 'DELETE').length, 1); assert.equal(new URL(removed.requests.find(x => x.method === 'DELETE').url).pathname, `${base.pathname}/orders/o-1`); assert.ok(removed.dom.window.document.querySelector('#orders .empty')); assert.equal(removed.unhandled.length, 0); assert.equal(removed.forbidden.length, 0);
  for (const failure of [{ type: 'bad' }, { type: 'timeout' }, { type: 'invalid' }]) { const b = await boot('/account.html', { queue: [api([hostile]), failure], confirmResult: true }); click(b.dom, '[data-order-delete="o-1"]'); await settle(b.dom); assert.equal(b.dom.window.document.querySelectorAll('#orders .order').length, 1, failure.type); assert.equal(b.requests.filter(x => x.method === 'DELETE').length, 1, failure.type); assert.equal(b.unhandled.length, 0, failure.type); }
  for (const failure of [{ type: 'bad' }, { type: 'timeout' }, { type: 'invalid' }]) { const b = await boot('/account.html', { queue: [failure] }); const bd = b.dom.window.document; assert.ok(bd.querySelector('#orders .error')); assert.equal(b.unhandled.length, 0); assert.equal(b.forbidden.length, 0); }
  const detailFail = await boot('/account.html', { queue: [api([hostile]), { type: 'bad' }] }); click(detailFail.dom, '[data-order-view="o-1"]'); await settle(detailFail.dom); await wait(20); assert.equal(detailFail.dom.window.document.querySelector('#orderModal'), null); assert.equal(detailFail.requests.filter(x => x.method === 'GET').length, 2); assert.equal(detailFail.unhandled.length, 0);
});

test('auth modes and invalid configuration variants fail or omit browser credentials exactly', async () => {
  for (const [mode, token, expected] of [['none', 'secret', undefined], ['bearer', 'secret', 'Bearer secret'], ['bearer', null, undefined], ['bff', 'secret', undefined]]) {
    const c = structuredClone(runtime); c.api.auth.mode = mode; const b = await boot('/index.html', { artifactOverrides: { 'config/runtime.json': c }, storage: token === null ? {} : { 'nordcart-api-key': token }, queue: [api(goodSet)] }); const request = b.requests.find(x => x.url.includes('/goods')); assert.ok(request, mode); assert.equal(request.headers.Authorization, expected); assert.equal(new URL(request.url).searchParams.has('api_key'), false); assert.equal(b.forbidden.length, 0);
  }
  const badAuth = structuredClone(runtime); badAuth.api.auth.mode = 'invalid'; const inert = await boot('/index.html', { artifactOverrides: { 'config/runtime.json': badAuth }, queue: [api(goodSet)] }); assert.equal(inert.dom.window.document.querySelector('#products'), null); assert.equal(inert.requests.length, 0); assert.equal(inert.unhandled.length, 0);
  const variants = [
    ['api.baseUrl', c => { c.api.baseUrl = 'https://evil.example/api?x=1'; }],
    ['route', c => { c.navigation.catalog[0].href = '//evil.example/cart.html'; }],
    ['version', c => { c.version = '2'; }],
    ['message', c => { c.navigation.catalog[0].label = 'missing'; }],
    ['cache', c => { c.cache.ttlMs = 0; }],
    ['image', c => { c.security.imageUrl.hosts = []; }]
  ];
  for (const [name, mutate] of variants) { const c = structuredClone(runtime); mutate(c); const b = await boot('/index.html', { artifactOverrides: { 'config/runtime.json': c }, queue: [api(goodSet)] }); assert.equal(b.dom.window.document.querySelector('#products'), null, name); assert.equal(b.requests.length, 0, name); assert.equal(b.forbidden.length, 0, name); }
});

test('hostile text and unsafe image use text nodes and configured placeholder', async () => {
  const hostile = [{ ...goodSet[0], name: '<img src=x onerror=alert(1)>', main_category: '<script>alert(1)</script>', image_url: 'https://not-allowed.example/image.jpg' }];
  const b = await boot('/index.html', { queue: [api([]), api(['<svg onload=alert(1)>'])] }); const d = b.dom.window.document;
  const safeCard = d.defaultView.card(hostile[0]); d.querySelector('#products').replaceChildren(safeCard); assert.equal(d.querySelectorAll('script').length, 0); assert.match(d.querySelector('#products h3').textContent, /<img/); assert.equal(d.querySelector('#products img').src, new URL(original.get('data/placeholders.json').image, d.baseURI).href); d.querySelector('#search').value = 'x'; dispatch(b.dom, d.querySelector('#search'), 'input'); await settle(b.dom); assert.match(d.querySelector('[data-suggest]').textContent, /<svg/); assert.equal(d.querySelectorAll('script').length, 0); assert.equal(b.unhandled.length, 0); assert.equal(b.forbidden.length, 0);
});

test('validator one-field fixtures fail closed across contract/messages/schema/cache/runtime families', async () => {
  const cases = [];
  const add = (name, file, mutate) => { const value = structuredClone(original.get(file)); mutate(value); cases.push([name, { [file]: value }]); };
  add('contract unsafe route', 'config/api-contract.json', x => { x.routes.goods.path = '//evil'; });
  add('contract wrong method', 'config/api-contract.json', x => { x.routes.goods.methods = ['POST']; });
  add('contract missing route', 'config/api-contract.json', x => { delete x.routes.autocomplete; });
  add('contract payload mismatch', 'config/api-contract.json', x => { x.orderPayload.fields.pop(); });
  add('messages missing copy', 'config/messages.ru.json', x => { delete x.copy.catalog; });
  add('messages states mismatch', 'config/messages.ru.json', x => { x.states.pop(); });
  add('schema duplicate field', 'data/checkout-schema.json', x => { x.fields[1].name = x.fields[0].name; });
  add('schema extra field', 'data/checkout-schema.json', x => { x.fields.push({ name: 'extra', type: 'string', required: false }); });
  add('schema wrong type', 'data/checkout-schema.json', x => { x.fields[0].type = 'number'; });
  add('schema required mismatch', 'data/checkout-schema.json', x => { x.fields[0].required = false; });
  add('schema invalid pattern', 'data/checkout-schema.json', x => { x.fields[0].pattern = '['; });
  add('schema invalid date', 'data/checkout-schema.json', x => { x.fields.find(f => f.type === 'date').minDate = 'bad-date'; });
  add('schema cart bound', 'data/checkout-schema.json', x => { x.cart.maxItems = -1; });
  add('schema delivery duplicate', 'data/checkout-schema.json', x => { x.delivery.intervalOptions.push(x.delivery.intervalOptions[0]); });
  add('cache policy', 'config/runtime.json', x => { x.cache.onFailure = 'demo'; });
  add('image allowlist', 'config/runtime.json', x => { x.security.imageUrl.schemes = []; });
  add('placeholder type', 'data/placeholders.json', x => { x.image = ''; });
  add('runtime version', 'config/runtime.json', x => { x.version = '2'; });
  add('runtime navigation', 'config/runtime.json', x => { x.navigation.catalog[0].href = '//evil.example/cart.html'; });
  add('runtime base credentials', 'config/runtime.json', x => { x.api.baseUrl += '?token=secret'; });
  add('runtime auth', 'config/runtime.json', x => { x.api.auth.mode = 'invalid'; });
  for (const [name, overrides] of cases) { const b = await boot('/index.html', { artifactOverrides: overrides, queue: [api(goodSet)] }); assert.equal(b.dom.window.document.querySelector('#products'), null, name); assert.equal(b.requests.length, 0, name); assert.equal(b.forbidden.length, 0, name); assert.equal(b.unhandled.length, 0, name); }
});
