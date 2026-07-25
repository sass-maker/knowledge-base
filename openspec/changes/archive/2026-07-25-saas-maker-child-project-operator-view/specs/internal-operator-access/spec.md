## ADDED Requirements

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

## MODIFIED Requirements

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
