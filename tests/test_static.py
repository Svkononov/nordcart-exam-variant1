from pathlib import Path
import json
import re

ROOT=Path(__file__).parents[1]
IMPLEMENTATION=[ROOT/n for n in ('app.js','index.html','cart.html','account.html')]
ALLOWED=(ROOT/'config',ROOT/'data')

def source_text():
    return '\n'.join(p.read_text() for p in IMPLEMENTATION)

def test_artifacts_parse():
    for directory in (ROOT/'config',ROOT/'data'):
        for path in directory.glob('*.json'):
            json.loads(path.read_text())

def test_implementation_has_no_forbidden_runtime_literals_or_sinks():
    text=source_text()
    assert 'innerHTML' not in text
    assert 'api_key=' not in text
    assert 'edu.std-900' not in text
    assert 'Nordic Trail' not in text
    assert 'setTimeout(()=>{},8000)' not in text
    assert not re.search(r'(?<![A-Za-z])\b(?:08:00-12:00|12:00-14:00|14:00-18:00|18:00-22:00)\b',text)

def test_systematic_config_values_are_not_duplicated_in_runtime():
    text=source_text()
    runtime=json.loads((ROOT/'config/runtime.json').read_text())
    contract=json.loads((ROOT/'config/api-contract.json').read_text())
    messages=json.loads((ROOT/'config/messages.ru.json').read_text())
    schema=json.loads((ROOT/'data/checkout-schema.json').read_text())
    forbidden={runtime['api']['baseUrl']}
    forbidden.update(messages['copy'].values())
    forbidden.update(schema['delivery']['intervalOptions'])
    for field in schema['fields']:
        for key in ('minDate','maxDate','minLength','maxLength'):
            if key in field and not isinstance(field[key], int) or key in field and field[key] not in (0,1,2,3): forbidden.add(str(field[key]))
    for value in (runtime['api']['timeoutMs'],runtime['api']['pageSize'],runtime['cache']['ttlMs'],runtime['uiRules']['retry']['maxAttempts'],schema['cart']['minimumTotal'],schema['cart']['minItems'],schema['cart']['maxItems']):
        if value not in (0,1,2,3): forbidden.add(str(value))
    # Route/mode names and the credential storage key are structural adapter identifiers.
    structural={'GET','POST','DELETE','goods','autocomplete','orders','orderById','nordcart-api-key','nordcart-cart','nordcart-catalog-cache-v1','api','online','empty','loading','ready','error','boot'}
    for value in forbidden:
        if not value or value in structural: continue
        assert value not in text, value
    assert (ROOT/'data/catalog.json').exists()
    shipped='\n'.join(p.read_text() for p in ROOT.rglob('*') if p.is_file() and p.suffix in {'.js','.html','.json'} and 'node_modules' not in p.parts and '.git' not in p.parts)
    assert not re.search(r'demo-goods|(?:^|[^a-z])(?:demo|outage|unavailable)(?:[^a-z]|$)',shipped,re.I)
    html='\n'.join((ROOT/n).read_text() for n in ('index.html','cart.html','account.html'))
    js=(ROOT/'app.js').read_text()
    assert not re.search(r'<script\b(?![^>]*\bsrc\s*=)|\bon[a-z]+\s*=',html,re.I)
    assert not re.search(r'\beval\s*\(|document\.write|outerHTML|insertAdjacentHTML|innerHTML',js,re.I)

def test_html_is_inert_shell():
    for path in (ROOT/'index.html',ROOT/'cart.html',ROOT/'account.html'):
        text=path.read_text()
        assert 'bootstrap-shell' in text
        assert not re.search(r'>[^<]+<',text.replace('<!doctype html>',''))

def test_checkout_rules_are_data_defined():
    schema=json.loads((ROOT/'data/checkout-schema.json').read_text())
    assert schema['fields'] and schema['delivery']['intervalOptions']
    assert all('required' in field for field in schema['fields'])
    assert not schema['fields'][6].get('options')

def test_behavior_boundaries_are_present_without_external_calls():
    source=(ROOT/'app.js').read_text()
    for marker in ('catalogEvents','orderActions','Authorization','searchParams.set','S.placeholders.image','S.schema.cart.minItems','S.schema.cart.maxItems','S.schema.fields.filter(x=>x.type===\'boolean\')'):
        assert marker in source

def test_contract_and_auth_negative_boundaries_are_declared():
    runtime=json.loads((ROOT/'config/runtime.json').read_text())
    contract=json.loads((ROOT/'config/api-contract.json').read_text())
    assert runtime['api']['auth']['mode'] in {'none','bearer','bff'}
    assert set(contract['routes']) >= {'goods','autocomplete','orders','orderById'}
    assert 'api_key' not in (ROOT/'config/runtime.json').read_text()
    assert runtime['cache']['onFailure'] == 'cache-or-snapshot'
