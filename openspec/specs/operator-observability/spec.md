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

The dashboard SHALL present Overview, Data, Query, Ingest, Query History,
Evals, Domains, and Settings as internal operator workflows without linking to
a separate marketing surface.

#### Scenario: Operator uses the sidebar

- **WHEN** the operator selects Data or Query History
- **THEN** the corresponding first-class route renders within the dashboard shell
