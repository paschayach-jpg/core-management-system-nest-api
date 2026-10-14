import { camelizeKeys, camelKey } from '../../src/common/utils/camelize';

describe('camelKey / camelizeKeys', () => {
  it.each([
    ['ConfigID', 'configId'],
    ['OrgUnitNameTH', 'orgUnitNameTh'],
    ['IsDeleted', 'isDeleted'],
    ['ADUserName', 'adUserName'],
    ['URLPath', 'urlPath'],
    ['FolderID', 'folderId'],
    ['AuditID', 'auditId'],
    ['id', 'id'],
  ])('%s → %s', (input, expected) => {
    expect(camelKey(input)).toBe(expected);
  });

  it('แปลงทั้ง object และ array โดยไม่แตะ Date/Buffer', () => {
    const d = new Date();
    expect(camelizeKeys({ OrgUnitID: 1, CreatedDate: d })).toEqual({
      orgUnitId: 1,
      createdDate: d,
    });
    expect(camelizeKeys([{ UserID: 1 }, { UserID: 2 }])).toEqual([{ userId: 1 }, { userId: 2 }]);
    expect(camelizeKeys(null)).toBeNull();
  });
});
