import { describe, expect, it } from 'vitest';

import { SNAPSHOT_SCHEMA_VERSION, readSnapshot, type SnapshotUpgraders } from './snapshots.js';

/**
 * Revisions are never migrated in place (DB §6.2): an old snapshot is upgraded
 * when it is read. No aggregate has changed shape yet, so there are no
 * upgraders; these tests prove the path with one made up for the purpose.
 */

const party = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  id: '0199a000-0000-7000-8000-000000000001',
  version: 1,
  createdAt: '2026-02-10T08:00:00.000Z',
  updatedAt: '2026-02-10T08:00:00.000Z',
  slug: 'northwind',
  kind: 'client',
  legalName: 'Northwind Logistics B.V.',
  country: 'NL',
  contactName: null,
  contactEmail: null,
  dpoName: null,
  dpoEmail: null,
  trustUrl: null,
  dpaUrl: null,
  subprocessorListUrl: null,
};

/** A party as an imagined earlier shape wrote it: `name`, not `legalName`. */
const { legalName: _legalName, ...rest } = party;
const olderParty = { ...rest, schemaVersion: SNAPSHOT_SCHEMA_VERSION - 1, name: party.legalName };

const renameUpgrader: SnapshotUpgraders = {
  party: {
    [SNAPSHOT_SCHEMA_VERSION - 1]: ({ name, ...snapshot }) => ({
      ...snapshot,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      legalName: name,
    }),
  },
};

describe('readSnapshot', () => {
  it('parses a snapshot of the current version as it is', () => {
    expect(readSnapshot('party', party)).toEqual(party);
  });

  it('upgrades an older snapshot, then validates the result', () => {
    expect(readSnapshot('party', olderParty, renameUpgrader)).toEqual(party);
  });

  it('fails loudly on an older snapshot nothing can upgrade', () => {
    expect(() => readSnapshot('party', olderParty, {})).toThrow(
      `No upgrader for party snapshots from schemaVersion ${SNAPSHOT_SCHEMA_VERSION - 1}`,
    );
  });

  it('fails on an upgrader that does not move the snapshot on by one version', () => {
    const stuck: SnapshotUpgraders = {
      party: { [SNAPSHOT_SCHEMA_VERSION - 1]: (snapshot) => snapshot },
    };
    expect(() => readSnapshot('party', olderParty, stuck)).toThrow(
      `The party upgrader from schemaVersion ${SNAPSHOT_SCHEMA_VERSION - 1} returned schemaVersion ${SNAPSHOT_SCHEMA_VERSION - 1}`,
    );
  });

  it('refuses a snapshot written by newer code than this', () => {
    expect(() =>
      readSnapshot('party', { ...party, schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1 }),
    ).toThrow(`newer than this code understands (${SNAPSHOT_SCHEMA_VERSION})`);
  });

  it('refuses a snapshot with no schemaVersion at all', () => {
    const { schemaVersion: _version, ...unversioned } = party;
    expect(() => readSnapshot('party', unversioned)).toThrow('has no schemaVersion');
  });

  it('still validates the current shape: history that no longer parses is a bug', () => {
    expect(() => readSnapshot('party', { ...party, legalName: '' })).toThrow();
  });
});
