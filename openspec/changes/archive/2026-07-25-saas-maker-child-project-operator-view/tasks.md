## 1. Worker authorization

- [x] 1.1 Preserve credential source in the Worker auth context and validate dashboard-only project overrides.
- [x] 1.2 Add the dashboard-only operator project inventory route.
- [x] 1.3 Cover dashboard inventory, override, invalid identifier, and consumer-isolation behavior with Worker tests.

## 2. Dashboard project model

- [x] 2.1 Forward the selected project header through the Access-verified Pages proxy.
- [x] 2.2 Add project inventory types, API calls, classification, labels, and request scoping to the app client.
- [x] 2.3 Add a project provider and compact sidebar selector with internal-scope visibility control.
- [x] 2.4 Remount routes when project selection changes and provide useful no-project/loading/error states.

## 3. Product framing

- [x] 3.1 Update dashboard metadata and visible copy to “SaaS Maker Knowledgebase.”
- [x] 3.2 Update operational documentation and status without claiming production data deletion or deployment.

## 4. Verification

- [x] 4.1 Run focused Worker tests and typecheck.
- [x] 4.2 Run app typecheck and production build.
- [x] 4.3 Run OpenSpec validation, docs checks, and `git diff --check`.
