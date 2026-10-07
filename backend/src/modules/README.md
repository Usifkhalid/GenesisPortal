One folder per feature module, each with routes.js, service.js and schema.js.
Routers mount in src/app.js. Every module scopes its reads and writes by company
through lib/scope.js and ships a test proving cross-company access is refused.
