import { describe, expect, it } from 'vitest';

import * as enums from './enums.js';
import {
  ACTIVITY_ROLES,
  AGREEMENT_DIRECTIONS,
  AUTHORIZATION_TYPES,
  DATA_CATEGORY_SPECIALS,
  ENGAGEMENT_ROLES,
  EVENT_TYPES,
  FINDING_SEVERITIES,
  FINDING_TYPES,
  LAWFUL_BASES,
  PARTY_KINDS,
  RENDER_SYSTEM_KINDS,
  REVIEW_CHANGE_TYPES,
  REVIEW_REASONS,
  REVIEW_TARGET_TYPES,
  SPECIAL_CONDITIONS,
  SYSTEM_KINDS,
  TAXONOMY_TYPES,
  TRANSFER_MECHANISMS,
} from './enums.js';

/**
 * These lists are the single definition of each vocabulary: Zod reads them here
 * and Drizzle's check constraints read the same arrays (ropa-database.md §1).
 * A value added to one and not the other is exactly the drift this prevents.
 */
describe('enum lists', () => {
  const lists: [string, readonly string[]][] = Object.entries(enums)
    .filter(([, value]) => Array.isArray(value))
    .map(([name, value]) => [name, value as readonly string[]]);

  it('exports several lists, all non-empty', () => {
    expect(lists.length).toBeGreaterThan(10);
    for (const [name, values] of lists) {
      expect(values.length, name).toBeGreaterThan(0);
    }
  });

  it('never repeats a value within a list', () => {
    for (const [name, values] of lists) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('is frozen, so nothing can push a value in at runtime', () => {
    for (const [name, values] of lists) {
      expect(Object.isFrozen(values), name).toBe(true);
    }
  });
});

describe('the values the data model names', () => {
  it('has the six Art. 6(1) lawful bases', () => {
    expect(LAWFUL_BASES).toEqual([
      '6(1)(a)',
      '6(1)(b)',
      '6(1)(c)',
      '6(1)(d)',
      '6(1)(e)',
      '6(1)(f)',
    ]);
  });

  it('has the ten Art. 9(2) conditions plus Art. 10', () => {
    expect(SPECIAL_CONDITIONS).toHaveLength(11);
    expect(SPECIAL_CONDITIONS).toContain('9(2)(a)');
    expect(SPECIAL_CONDITIONS).toContain('9(2)(j)');
    expect(SPECIAL_CONDITIONS).toContain('art10');
  });

  it('keeps joint_controller in the vocabulary, deferred but not deleted (DM §10, Q5)', () => {
    expect(ACTIVITY_ROLES).toContain('joint_controller');
    expect(ENGAGEMENT_ROLES).toContain('joint_controller');
  });

  it('matches the data model on parties, agreements and transfers', () => {
    expect(PARTY_KINDS).toEqual(['self', 'client', 'vendor', 'other']);
    expect(AGREEMENT_DIRECTIONS).toEqual(['outbound', 'inbound']);
    expect(AUTHORIZATION_TYPES).toEqual(['general', 'specific']);
    expect(TRANSFER_MECHANISMS).toEqual(['adequacy', 'dpf', 'sccs', 'bcr', 'derogation_49']);
    expect(DATA_CATEGORY_SPECIALS).toEqual(['none', 'art9', 'art10']);
  });

  it('lists the Render system kinds plus external SaaS', () => {
    expect(SYSTEM_KINDS).toContain('external_saas');
    expect(SYSTEM_KINDS).toHaveLength(8);
  });

  it('derives the Render system kinds from the full list, so the two cannot drift', () => {
    expect(RENDER_SYSTEM_KINDS).toEqual(SYSTEM_KINDS.filter((kind) => kind.startsWith('render_')));
    expect(RENDER_SYSTEM_KINDS).not.toContain('external_saas');
  });

  it('points review items at the three records a finding can be about (DM §3.11)', () => {
    expect(REVIEW_TARGET_TYPES).toEqual(['activity', 'party', 'system']);
  });

  it('gives review items their own event, since they have no revisions (step 3, Q1)', () => {
    expect(EVENT_TYPES).toContain('review_item.changed');
    expect(REVIEW_CHANGE_TYPES).toEqual(['opened', 'resolved', 'dismissed']);
  });

  it('names the five coverage findings, three severities, high first (§5.5, Q3)', () => {
    expect(FINDING_TYPES).toEqual([
      'unmapped_system',
      'transfer_missing',
      'external_saas_mismatch',
      'region_violation',
      'review_overdue',
    ]);
    expect(FINDING_SEVERITIES).toEqual(['high', 'medium', 'low']);
  });

  it('can carry every coverage finding to a review item', () => {
    for (const type of FINDING_TYPES) expect(REVIEW_REASONS).toContain(type);
  });

  it('names the taxonomy types as they appear in URLs', () => {
    expect(TAXONOMY_TYPES).toEqual(['subject-categories', 'data-categories', 'security-measures']);
  });
});
