# operator-observability Specification

## Purpose

Define the internal dashboard surfaces and Worker read APIs operators use to
inspect corpus data, ingestion state, query provenance, and retrieval quality.
## Requirements
### Requirement: Corpus data inspection

The dashboard SHALL provide a dedicated Data screen for inspecting files,
stored chunks, ingestion jobs, entities, and relationships across the
operator's domains.

#### Scenario: Operator inspects a domain

- **WHEN** the operator selects a domain and data type
- **THEN** the screen shows the matching records with provenance-relevant fields, loading, empty, and error states

#### Scenario: Operator narrows records

- **WHEN** the operator applies text, status, or type filters
- **THEN** the visible records and pagination update to the matching subset

### Requirement: Stored chunk provenance

The Worker SHALL expose a service-key-protected read route for stored chunks
that returns the chunk identifier, file identifier, page range, excerpt, and
metadata.

#### Scenario: Filter chunks by source

- **WHEN** an authenticated caller supplies a domain or file identifier
- **THEN** the Worker returns only matching chunks within the bounded limit

#### Scenario: Cross-tenant chunk request

- **WHEN** a caller requests chunks using one tenant's service key
- **THEN** no chunk belonging to another tenant is returned

### Requirement: Query history inspection

The dashboard SHALL provide Query History across all domains with domain,
question, and mode filters, pagination, answer and citation expansion, export,
and quality drilldown.

#### Scenario: Operator opens query history

- **WHEN** the operator opens Query History without a domain filter
- **THEN** recent traces across the authenticated tenant are shown newest first

#### Scenario: Operator expands a trace

- **WHEN** the operator expands a query trace
- **THEN** the answer, latency, citations, provenance, and available quality drilldown are visible

### Requirement: Canonical operator navigation

The dashboard SHALL identify itself as the private SaaS Maker Knowledgebase,
present the selected child project, and provide Overview, Data, Query, Ingest,
Query History, Evals, Domains, and Settings as internal operator workflows
without linking to a separate marketing surface.

#### Scenario: Operator uses the sidebar

- **WHEN** the operator selects a project and then selects Data or Query History
- **THEN** the corresponding first-class route renders within the dashboard
  shell for that project

### Requirement: Project inventory and selection

The dashboard SHALL present the Knowledgebase scopes used by SaaS Maker
projects and SHALL reload operator workflows within the selected project.

#### Scenario: Operator opens the dashboard

- **WHEN** project scopes contain real and internal-only data
- **THEN** the dashboard selects a real project and hides demo, smoke, proof,
  verification, and performance scopes by default

#### Scenario: Operator switches projects

- **WHEN** the operator selects another visible project
- **THEN** Overview, Data, Query History, Domains, Query, Ingest, Evals, and
  Settings reload within the selected project scope

#### Scenario: Operator inspects internal scopes

- **WHEN** the operator enables internal scopes
- **THEN** hidden demo and verification scopes become selectable without
  deleting or reclassifying their stored data

### Requirement: Dashboard-only project discovery

The Worker SHALL expose a project inventory only to the dedicated dashboard
credential and SHALL preserve the tenant-scoped project response for ordinary
service credentials.

#### Scenario: Dashboard lists projects

- **WHEN** the dashboard credential requests the operator project inventory
- **THEN** the Worker returns known project identifiers with bounded summary
  metadata

#### Scenario: Consumer lists operator projects

- **WHEN** a non-dashboard service credential requests the operator project
  inventory
- **THEN** the Worker returns `403` without exposing other projects

