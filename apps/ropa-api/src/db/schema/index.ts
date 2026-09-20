/**
 * The database schema: the source of truth for Postgres. SQL migrations are
 * generated from it, reviewed and committed (`ropa-database.md` §1).
 *
 * Step 1 covers the foundation records plus history and events. The activity
 * aggregate (§4.4) and `review_item` (§4.5) arrive in step 2.
 */
export * from './party.js';
export * from './agreement.js';
export * from './system.js';
export * from './taxonomy.js';
export * from './history.js';
