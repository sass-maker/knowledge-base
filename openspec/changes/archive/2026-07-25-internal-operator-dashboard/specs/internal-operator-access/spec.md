## ADDED Requirements

### Requirement: Verified operator identity

The dashboard API boundary MUST accept only Cloudflare Access assertions whose
signature, issuer, audience, and time claims validate against the configured
Access application.

#### Scenario: Valid Access session

- **WHEN** an operator request contains a valid assertion for the configured Access application
- **THEN** the dashboard session endpoint returns the verified operator identity

#### Scenario: Missing or invalid assertion

- **WHEN** an operator request has no valid Access assertion
- **THEN** the API boundary rejects it without forwarding a request to the RAG Worker

### Requirement: Server-side Worker credentials

The dashboard proxy MUST inject the RAG service key from server-side
configuration and MUST NOT expose or persist that key in browser code or
storage.

#### Scenario: Authenticated dashboard API request

- **WHEN** a verified operator requests an allowed `/api/v1/*` path
- **THEN** the proxy forwards the request to the configured Worker with server-side service-key authentication

#### Scenario: Browser inspection

- **WHEN** an operator inspects dashboard storage, scripts, or outgoing browser requests
- **THEN** no RAG service key is present

### Requirement: Fail-closed proxy configuration

The dashboard proxy MUST reject requests when required Access or upstream
configuration is missing and MUST restrict forwarding to Worker `/v1/*` paths.

#### Scenario: Missing server configuration

- **WHEN** a required Access, Worker URL, or Worker key binding is absent
- **THEN** the proxy returns a configuration error without contacting an upstream host

#### Scenario: Unsupported proxy path

- **WHEN** a request attempts to proxy a path outside `/v1/*`
- **THEN** the proxy rejects the request
