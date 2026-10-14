import type { EntityManager } from 'typeorm';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { Employee } from '../../shared/entities/employee.entity';
import { HrDepartment } from '../../shared/entities/hr-department.entity';
import { HrDivision } from '../../shared/entities/hr-division.entity';
import { SubCommittee } from '../../shared/entities/sub-committee.entity';
import { ProjectMember } from '../entities/project-member.entity';
import { ProjectMemberRole } from '../entities/project-member-role.entity';
import { ProjectStateMember } from '../entities/project-state-member.entity';

/**
 * ประเภท "บุคคลที่เกี่ยวข้อง" ของโครงการ — ระบบเดิมเก็บข้อความภาษาไทยลงคอลัมน์ `c_member_type`
 * ('คณะกรรมการ' | 'ฝ่าย' | 'แผนก' | 'พนักงาน') API รับรหัสอังกฤษแล้วแปลงเป็นข้อความเดิมเพื่อให้ข้อมูลตรงกับที่ระบบเก่าอ่าน
 */
export const MEMBER_TYPES = ['SubCommittee', 'Division', 'Department', 'Employee'] as const;
export type MemberTypeCode = (typeof MEMBER_TYPES)[number];

export const MEMBER_TYPE_LABEL: Record<MemberTypeCode, string> = {
  SubCommittee: 'คณะกรรมการ',
  Division: 'ฝ่าย',
  Department: 'แผนก',
  Employee: 'พนักงาน',
};

/** ข้อความที่เก็บในฐานข้อมูล → รหัส (ไม่รู้จัก = null) */
export function memberTypeCodeOf(label: string | null | undefined): MemberTypeCode | null {
  const found = MEMBER_TYPES.find((c) => MEMBER_TYPE_LABEL[c] === label);
  return found ?? null;
}

export interface MemberRefInput {
  memberType: MemberTypeCode;
  /** SubCommitteeID / DivisionID / DepartmentID (ประเภท SubCommittee, Division, Department) */
  orgId?: number;
  /** ชื่อผู้ใช้ AD (ประเภท Employee) */
  adUserName?: string;
}

export interface ResolvedMember {
  name: string;
  memberTypeLabel: string;
  /** DivisionCode / DepartmentCode (ประเภท Division, Department) */
  departmentCode: string | null;
}

/**
 * แปลงข้อมูลที่ client เลือก (ประเภท + id/ชื่อผู้ใช้) เป็นชื่อ/รหัสที่เก็บจริง โดยอ่านจากตาราง EMS.m_* ของฐานหลัก
 * ไม่เชื่อชื่อที่ client ส่งมา (ระบบเดิมเชื่อค่าจาก ComboBox) · ระบบเดิมดึง 3 ตารางนี้ผ่าน BisDb (อ้างฐาน CMS_DB เดิม)
 * ที่นี่ใช้ฐานหลักโดยตรง · แสดงเฉพาะรายการที่ยังใช้งานอยู่
 */
export async function resolveMemberRef(
  manager: EntityManager,
  ref: MemberRefInput,
): Promise<ResolvedMember> {
  const label = MEMBER_TYPE_LABEL[ref.memberType];
  switch (ref.memberType) {
    case 'SubCommittee': {
      const row = ref.orgId
        ? await manager.findOneBy(SubCommittee, {
            subCommitteeId: ref.orgId,
            isDeleted: false,
            isActive: true,
          })
        : null;
      if (!row) throw notFound('คณะกรรมการ', ref.orgId);
      return { name: row.subCommitteeNameTh, memberTypeLabel: label, departmentCode: null };
    }
    case 'Division': {
      const row = ref.orgId
        ? await manager.findOneBy(HrDivision, { divisionId: ref.orgId, isActive: true })
        : null;
      if (!row) throw notFound('ฝ่าย', ref.orgId);
      return { name: row.divisionName, memberTypeLabel: label, departmentCode: row.divisionCode };
    }
    case 'Department': {
      const row = ref.orgId
        ? await manager.findOneBy(HrDepartment, { departmentId: ref.orgId, isActive: true })
        : null;
      if (!row) throw notFound('แผนก', ref.orgId);
      return {
        name: row.departmentName,
        memberTypeLabel: label,
        departmentCode: row.departmentCode,
      };
    }
    case 'Employee': {
      const ad = ref.adUserName?.trim();
      const row = ad
        ? await manager.findOneBy(Employee, { adUserName: ad, isActive: true, isAnonymized: false })
        : null;
      if (!row) throw notFound('พนักงาน', ad);
      return { name: row.adUserName ?? ad ?? '', memberTypeLabel: label, departmentCode: null };
    }
  }
}

function notFound(what: string, id: number | string | undefined): BusinessException {
  return new BusinessException(
    `ไม่พบ${what}${id !== undefined ? ` (${id})` : ''} หรือถูกปิดใช้งานแล้ว`,
    'MEMBER_REF_NOT_FOUND',
  );
}

/** บทบาทต้องเป็นบทบาทที่เปิดใช้งานอยู่ใน RGP.m_project_member_role (ระบบเดิมให้เลือกจากรายการนี้เท่านั้น) */
export async function assertActiveRole(manager: EntityManager, roleName: string): Promise<string> {
  const name = roleName.trim();
  const role = await manager.findOneBy(ProjectMemberRole, { roleName: name, active: 'Y' });
  if (!role) {
    throw new BusinessException(
      `ไม่พบบทบาท '${name}' หรือถูกปิดใช้งาน — เลือกจากรายการบทบาทของโครงการ`,
      'MEMBER_ROLE_NOT_FOUND',
    );
  }
  return role.roleName;
}

/** เพิ่มบุคคลที่เกี่ยวข้องของโครงการ */
export async function insertProjectMember(
  manager: EntityManager,
  projectId: number,
  ref: MemberRefInput,
  roleName: string,
  actor: string,
): Promise<ProjectMember> {
  const resolved = await resolveMemberRef(manager, ref);
  const role = await assertActiveRole(manager, roleName);
  return manager.save(ProjectMember, {
    projectId,
    memberName: resolved.name,
    role,
    departmentCode: resolved.departmentCode,
    memberType: resolved.memberTypeLabel,
    createUser: actor,
  });
}

/** เพิ่มสมาชิกของขั้นตอนจากสมาชิกโครงการ (คัดลอกชื่อ/บทบาท/ประเภท) — ห้ามซ้ำชื่อเดิมใน state เดียวกัน (ไม่สนตัวพิมพ์) */
export async function insertStateMemberFrom(
  manager: EntityManager,
  state: { projStateId: number; projectId: number },
  projectMember: ProjectMember,
  actor: string,
): Promise<ProjectStateMember> {
  const existing = await manager.find(ProjectStateMember, {
    where: { projStateId: state.projStateId },
  });
  const dup = existing.some(
    (m) => m.memberName.toLowerCase() === projectMember.memberName.toLowerCase(),
  );
  if (dup) {
    throw new BusinessException(
      `'${projectMember.memberName}' ถูกเลือกเป็นผู้เกี่ยวข้องของขั้นตอนนี้แล้ว`,
      'STATE_MEMBER_DUPLICATE',
    );
  }
  return manager.save(ProjectStateMember, {
    projStateId: state.projStateId,
    projectId: state.projectId,
    memberName: projectMember.memberName,
    role: projectMember.role,
    memberType: projectMember.memberType ?? null,
    createUser: actor,
  });
}
