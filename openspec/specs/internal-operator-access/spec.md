# internal-operator-access Specification

## Purpose

Define the authenticated Pages boundary that verifies internal operators and
keeps Worker service credentials out of browser code and storage.
## Requirements
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
configuration, MAY forward a non-secret selected project identifier, and MUST
NOT expose or persist the service key in browser code or storage.

#### Scenario: Authenticated dashboard API request

- **WHEN** a verified operator requests an allowed `/api/v1/*` path for a
  selected project
- **THEN** the proxy forwards the request to the configured Worker with
  server-side dashboard-key authentication and the selected project identifier

#### Scenario: Browser inspection

- **WHEN** an operator inspects dashboard storage, scripts, or outgoing browser
  requests
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

### Requirement: Dashboard-scoped project selection

The Worker MUST distinguish dedicated dashboard credentials from consumer and
proof credentials, and MUST allow only a dashboard credential to select a
project scope for an authenticated request.

#### Scenario: Dashboard selects a project

- **WHEN** the Access-verified dashboard proxy sends a valid project identifier
  with its dedicated dashboard credential
- **THEN** the Worker evaluates the request within that project scope

#### Scenario: Consumer attempts a project override

- **WHEN** a consumer or proof credential sends a project override
- **THEN** the Worker rejects the override without reading or mutating the
  requested project

#### Scenario: Invalid project identifier

- **WHEN** a dashboard request sends an invalid project identifier
- **THEN** the Worker rejects the request before route handling

