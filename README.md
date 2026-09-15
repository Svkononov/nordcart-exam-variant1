# NordCart remediation

Runtime starts only after validating config, API contract, messages, checkout schema and catalog-cache policy. API URL, copy, auth mode, timeout, UI rules, field constraints, numeric/date limits and delivery options are data artifacts. Missing or invalid artifacts leave an inert shell and perform no API mutation.

The catalog never uses demo or outage fallback copy. A successful validated API response is cached under the configured key with schema version and TTL; on failure only an unexpired validated cache is rendered. Otherwise the catalog is a neutral configured empty state. Cache data is client-side, scoped by the configured key, and never authorizes checkout: only a current successful API response enables ordering.

The client never places credentials in a URL. A legacy localStorage key is read only for an approved Bearer adapter; sensitive credentials require a BFF. Checkout is enabled only for configured online mode after a successful GET. TLS/nginx/502 behavior is not emulated.
