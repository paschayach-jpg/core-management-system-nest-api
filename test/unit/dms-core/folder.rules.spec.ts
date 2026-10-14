import {
  assertMoveAllowed,
  assertRootCreationAllowed,
  assertUnderMainRoot,
  buildFolderPhysicalPath,
  isMainRoot,
  isSameFolderName,
  isWithinRecycleRetention,
  mainRootCode,
  projectedDepthAfterMove,
  recycleBinExpiryOf,
  resolveNewFolderAttributes,
  rootNameMatchesLevel,
  validateFolderName,
} from '../../../src/modules/dms/core/rules/folder.rules';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { getResponse(): { code: string } }).getResponse().code;
  }
  return undefined;
};

describe('folder.rules — ชื่อโฟลเดอร์', () => {
  it('ตัดช่องว่างหัวท้าย', () => {
    expect(validateFolderName('  งบประมาณ 2569  ')).toBe('งบประมาณ 2569');
  });

  it('ว่างหรือเว้นวรรคล้วน → FOLDER_NAME_REQUIRED', () => {
    expect(code(() => validateFolderName('   '))).toBe('FOLDER_NAME_REQUIRED');
    expect(code(() => validateFolderName(undefined))).toBe('FOLDER_NAME_REQUIRED');
  });

  it.each(['a\\b', 'a/b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'])(
    'อักขระต้องห้าม %s → FOLDER_NAME_INVALID',
    (name) => {
      expect(code(() => validateFolderName(name))).toBe('FOLDER_NAME_INVALID');
    },
  );

  it('ชื่อพิเศษ . / .. และอักขระควบคุมถูกปฏิเสธ', () => {
    expect(code(() => validateFolderName('..'))).toBe('FOLDER_NAME_INVALID');
    expect(code(() => validateFolderName('a\u0007b'))).toBe('FOLDER_NAME_INVALID');
  });

  it('ยาวเกิน 255 ตัวอักษร → FOLDER_NAME_TOO_LONG', () => {
    expect(code(() => validateFolderName('ก'.repeat(256)))).toBe('FOLDER_NAME_TOO_LONG');
    expect(validateFolderName('ก'.repeat(255))).toHaveLength(255);
  });

  it('เทียบชื่อซ้ำแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย', () => {
    expect(isSameFolderName(' Reports ', 'reports')).toBe(true);
    expect(isSameFolderName('Reports', 'Report')).toBe(false);
  });
});

describe('folder.rules — Root หลัก 1HC/2SC/3NC/4PC', () => {
  it('รหัสตามชั้นความลับ', () => {
    expect([1, 2, 3, 4].map(mainRootCode)).toEqual(['1HC', '2SC', '3NC', '4PC']);
    expect(mainRootCode(5)).toBe('');
  });

  it('ชื่อต้องขึ้นต้นด้วยรหัสของชั้นนั้น (ไม่สนตัวพิมพ์)', () => {
    expect(rootNameMatchesLevel('2SC - ฝ่ายบัญชี [2SC]', 2)).toBe(true);
    expect(rootNameMatchesLevel('  2sc ทดสอบ', 2)).toBe(true);
    expect(rootNameMatchesLevel('3NC - x', 2)).toBe(false);
    expect(rootNameMatchesLevel('', 2)).toBe(false);
  });

  it('ไม่ระบุชั้น/ชั้นนอก 1–4 → ROOT_FOLDER_NOT_ALLOWED', () => {
    expect(code(() => assertRootCreationAllowed({ name: 'X', level: undefined, existingRoots: [] }))).toBe(
      'ROOT_FOLDER_NOT_ALLOWED',
    );
    expect(code(() => assertRootCreationAllowed({ name: '5XX', level: 5, existingRoots: [] }))).toBe(
      'ROOT_FOLDER_NOT_ALLOWED',
    );
  });

  it('ชื่อไม่ตรงรหัส → ROOT_FOLDER_NAME_INVALID', () => {
    expect(
      code(() => assertRootCreationAllowed({ name: 'Finance', level: 2, existingRoots: [] })),
    ).toBe('ROOT_FOLDER_NAME_INVALID');
  });

  it('2SC/3NC/4PC มีได้อย่างละ 1 ต่อหน่วยงาน → ROOT_FOLDER_EXISTS', () => {
    const roots = [{ confidentialityLevel: 2 }];
    expect(code(() => assertRootCreationAllowed({ name: '2SC-2', level: 2, existingRoots: roots }))).toBe(
      'ROOT_FOLDER_EXISTS',
    );
    // Root ที่ถูกลบ/เก็บถาวรไม่นับ
    expect(
      code(() =>
        assertRootCreationAllowed({
          name: '2SC-2',
          level: 2,
          existingRoots: [{ confidentialityLevel: 2, isDeleted: true }, { confidentialityLevel: 2, isArchived: true }],
        }),
      ),
    ).toBeUndefined();
  });

  it('1HC มีได้หลายอัน (ข้ามการตรวจซ้ำ)', () => {
    expect(
      code(() =>
        assertRootCreationAllowed({
          name: '1HC - ลับมาก',
          level: 1,
          existingRoots: [{ confidentialityLevel: 1 }],
        }),
      ),
    ).toBeUndefined();
  });

  it('ต้องสร้างใต้ Root หลักเท่านั้น', () => {
    expect(isMainRoot({ parentFolderId: null, confidentialityLevel: 3, folderName: '3NC - a' })).toBe(true);
    expect(isMainRoot({ parentFolderId: 9, confidentialityLevel: 3, folderName: '3NC - a' })).toBe(false);
    expect(isMainRoot({ parentFolderId: null, confidentialityLevel: 3, folderName: 'อื่นๆ' })).toBe(false);
    expect(code(() => assertUnderMainRoot(null))).toBe('FOLDER_NOT_UNDER_MAIN_ROOT');
    expect(
      code(() => assertUnderMainRoot({ parentFolderId: null, confidentialityLevel: 4, folderName: 'Misc' })),
    ).toBe('FOLDER_NOT_UNDER_MAIN_ROOT');
  });
});

describe('folder.rules — ความลึก/ชั้นความลับ/InheritPermission', () => {
  it('Root: depth 1, ชั้นตามที่ระบุ, InheritPermission=false', () => {
    expect(resolveNewFolderAttributes({ parent: null, requestedLevel: 2 })).toEqual({
      depth: 1,
      confidentialityLevel: 2,
      inheritPermission: false,
    });
  });

  it('ลูกที่ไม่ระบุชั้น → สืบทอดจากแม่ + InheritPermission=true', () => {
    expect(
      resolveNewFolderAttributes({ parent: { folderDepth: 2, confidentialityLevel: 3 } }),
    ).toEqual({ depth: 3, confidentialityLevel: 3, inheritPermission: true });
  });

  it('ลูกที่ระบุชั้นเท่าแม่ → InheritPermission=false', () => {
    expect(
      resolveNewFolderAttributes({
        parent: { folderDepth: 1, confidentialityLevel: 2 },
        requestedLevel: 2,
      }),
    ).toEqual({ depth: 2, confidentialityLevel: 2, inheritPermission: false });
  });

  it('ลูกที่ระบุชั้นต่างจากแม่ → FOLDER_LEVEL_MISMATCH', () => {
    expect(
      code(() =>
        resolveNewFolderAttributes({
          parent: { folderDepth: 1, confidentialityLevel: 2 },
          requestedLevel: 4,
        }),
      ),
    ).toBe('FOLDER_LEVEL_MISMATCH');
  });

  it('ลึกได้ถึง 10 และชั้นที่ 11 ถูกปฏิเสธ → FOLDER_DEPTH_EXCEEDED', () => {
    expect(
      resolveNewFolderAttributes({ parent: { folderDepth: 9, confidentialityLevel: 4 } }).depth,
    ).toBe(10);
    expect(
      code(() => resolveNewFolderAttributes({ parent: { folderDepth: 10, confidentialityLevel: 4 } })),
    ).toBe('FOLDER_DEPTH_EXCEEDED');
  });
});

describe('folder.rules — ย้ายโฟลเดอร์', () => {
  const ok = {
    sourceId: 5,
    destId: 9,
    sourceName: 'รายงาน',
    sourceIsRoot: false,
    destIsInsideSource: false,
    projectedDepth: 4,
    destChildNames: ['อื่น'],
  };

  it('คำนวณความลึกหลังย้ายรวมความสูงของต้นไม้ย่อย', () => {
    expect(projectedDepthAfterMove({ destDepth: 3, sourceDepth: 2, maxSubtreeDepth: 5 })).toBe(7);
    expect(projectedDepthAfterMove({ destDepth: 3, sourceDepth: 2, maxSubtreeDepth: 2 })).toBe(4);
  });

  it('ผ่านเมื่อไม่ผิดกฎ', () => {
    expect(code(() => assertMoveAllowed(ok))).toBeUndefined();
  });

  it('Root หลักย้ายไม่ได้', () => {
    expect(code(() => assertMoveAllowed({ ...ok, sourceIsRoot: true }))).toBe('ROOT_FOLDER_IMMUTABLE');
  });

  it('ย้ายเข้าตัวเอง/เข้าลูกหลานของตัวเองไม่ได้', () => {
    expect(code(() => assertMoveAllowed({ ...ok, destId: 5 }))).toBe('FOLDER_MOVE_SELF');
    expect(code(() => assertMoveAllowed({ ...ok, destIsInsideSource: true }))).toBe(
      'FOLDER_MOVE_INTO_DESCENDANT',
    );
  });

  it('ลึกเกิน 10 หลังย้าย → FOLDER_DEPTH_EXCEEDED', () => {
    expect(code(() => assertMoveAllowed({ ...ok, projectedDepth: 11 }))).toBe('FOLDER_DEPTH_EXCEEDED');
  });

  it('ชื่อซ้ำในปลายทาง (ไม่สนตัวพิมพ์) → FOLDER_NAME_DUPLICATE', () => {
    expect(code(() => assertMoveAllowed({ ...ok, destChildNames: ['รายงาน '] }))).toBe(
      'FOLDER_NAME_DUPLICATE',
    );
  });
});

describe('folder.rules — ถังขยะ 30 วัน', () => {
  const now = new Date('2026-10-14T12:00:00');
  it('กู้คืนได้ภายใน 30 วัน และไม่ได้เมื่อเกิน', () => {
    expect(isWithinRecycleRetention(new Date('2026-09-20T12:00:00'), now)).toBe(true);
    expect(isWithinRecycleRetention(new Date('2026-09-14T12:00:00'), now)).toBe(true); // ครบ 30 วันพอดี
    expect(isWithinRecycleRetention(new Date('2026-09-14T11:59:00'), now)).toBe(false);
    expect(isWithinRecycleRetention(null, now)).toBe(true);
  });

  it('วันหมดอายุ = วันที่ลบ + 30 วัน', () => {
    expect(recycleBinExpiryOf(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
  });

  it('PhysicalPath ของโฟลเดอร์ตามรูปแบบเดิม', () => {
    expect(buildFolderPhysicalPath(12, 'abc')).toBe('12\\abc');
  });
});
