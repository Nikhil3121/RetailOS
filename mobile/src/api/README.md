# api/

Thin fetch wrappers around the Render backend. One file per resource (auth-api.ts, catalog-api.ts, sales-api.ts, day-sessions-api.ts, customers-api.ts). Same shape as desktop/src/lib/*-api.ts — copy verbatim except swap window.localStorage for AsyncStorage in the base api.ts.
