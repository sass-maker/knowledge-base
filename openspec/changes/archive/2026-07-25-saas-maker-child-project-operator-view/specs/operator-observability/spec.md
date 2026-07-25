## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Canonical operator navigation

The dashboard SHALL identify itself as the private SaaS Maker Knowledgebase,
present the selected child project, and provide Overview, Data, Query, Ingest,
Query History, Evals, Domains, and Settings as internal operator workflows
without linking to a separate marketing surface.

#### Scenario: Operator uses the sidebar

- **WHEN** the operator selects a project and then selects Data or Query History
- **THEN** the corresponding first-class route renders within the dashboard
  shell for that project
