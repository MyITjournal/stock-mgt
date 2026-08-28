import { applyTenantScope } from './tenant.prisma';
import { TenantContext } from './tenant-context';
import { OrgRole } from '@prisma/client';

const ORG = 'org-aaa';
const OTHER = 'org-bbb';

describe('applyTenantScope', () => {
  it('filters reads by the caller organization', () => {
    const out = applyTenantScope(
      'findMany',
      { where: { status: 'active' } },
      ORG,
    );
    expect(out.where).toEqual({ status: 'active', organizationId: ORG });
  });

  it('adds a where clause when the query had none', () => {
    expect(applyTenantScope('findMany', {}, ORG).where).toEqual({
      organizationId: ORG,
    });
  });

  it('scopes findUnique so another org cannot be addressed by id', () => {
    const out = applyTenantScope('findUnique', { where: { id: 'row-1' } }, ORG);
    expect(out.where).toEqual({ id: 'row-1', organizationId: ORG });
  });

  it('overrides an attempt to query a different organization', () => {
    const out = applyTenantScope(
      'findMany',
      { where: { organizationId: OTHER } },
      ORG,
    );
    expect(out.where).toEqual({ organizationId: ORG });
  });

  it('stamps the organization on create', () => {
    const out = applyTenantScope('create', { data: { userId: 'u1' } }, ORG);
    expect(out.data).toEqual({ userId: 'u1', organizationId: ORG });
  });

  it('stamps every row of createMany', () => {
    const out = applyTenantScope(
      'createMany',
      { data: [{ userId: 'u1' }, { userId: 'u2' }] },
      ORG,
    );
    expect(out.data).toEqual([
      { userId: 'u1', organizationId: ORG },
      { userId: 'u2', organizationId: ORG },
    ]);
  });

  it('scopes both halves of an upsert', () => {
    const out = applyTenantScope(
      'upsert',
      { where: { id: 'row-1' }, create: { userId: 'u1' }, update: {} },
      ORG,
    );
    expect(out.where).toEqual({ id: 'row-1', organizationId: ORG });
    expect(out.create).toEqual({ userId: 'u1', organizationId: ORG });
  });

  it.each(['update', 'updateMany', 'delete', 'deleteMany', 'count'])(
    'scopes %s',
    (operation) => {
      const out = applyTenantScope(operation, { where: { id: 'row-1' } }, ORG);
      expect(out.where).toMatchObject({ organizationId: ORG });
    },
  );

  it('does not mutate the caller-supplied args', () => {
    const args = { where: { id: 'row-1' } };
    applyTenantScope('findMany', args, ORG);
    expect(args).toEqual({ where: { id: 'row-1' } });
  });
});

describe('TenantContext', () => {
  it('is empty outside a request', () => {
    expect(TenantContext.organizationId()).toBeUndefined();
  });

  it('exposes the organization inside run()', () => {
    const store = {
      userId: 'u1',
      organizationId: ORG,
      orgRole: OrgRole.owner,
    };

    TenantContext.run(store, () => {
      expect(TenantContext.organizationId()).toBe(ORG);
    });
  });

  it('does not leak the organization after run() returns', () => {
    TenantContext.run(
      { userId: 'u1', organizationId: ORG, orgRole: OrgRole.owner },
      () => undefined,
    );
    expect(TenantContext.organizationId()).toBeUndefined();
  });
});
