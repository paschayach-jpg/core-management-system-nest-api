import type { ProjectDocDto } from '../documents/dto/document.dto';
import type { ProjectDocWorkflow } from '../entities/project-doc-workflow.entity';
import type { ProjectMember } from '../entities/project-member.entity';
import type { ProjectState } from '../entities/project-state.entity';
import type { ProjectStateMember } from '../entities/project-state-member.entity';
import type { ProjectMemberDto } from '../members/dto/member.dto';
import type { ProjectStateDto, StateMemberDto } from '../states/dto/state.dto';
import { memberTypeCodeOf } from './member-resolver';
import { fromYesNo } from './rgp-rules';

/**
 * แปลงข้อมูลจาก entity / ผลลัพธ์ SQL เป็น DTO ที่หลาย service ใช้ร่วมกัน
 * (flag Y/N → boolean, ไม่ส่ง entity ดิบออก API)
 */

/** แถวผลลัพธ์ของ STATES_WITH_PROGRESS_SQL (alias ตรงกับ DTO แต่ required เป็น 'Y'/'N') */
export interface StateRow extends Omit<ProjectStateDto, 'required'> {
  required: string;
}

export function stateRowToDto(row: StateRow): ProjectStateDto {
  return {
    ...row,
    required: fromYesNo(row.required),
    pctComplete: Number(row.pctComplete ?? 0),
    refPctOverall: Number(row.refPctOverall ?? 0),
  };
}

/** state ที่เพิ่งสร้าง/แก้ (ยังไม่มี progress) */
export function stateEntityToDto(
  s: ProjectState,
  extra: Partial<Pick<ProjectStateDto, 'pctComplete' | 'latestRemark'>> = {},
): ProjectStateDto {
  return {
    projStateId: s.projStateId,
    projectId: s.projectId,
    templateStateId: s.stateId ?? null,
    name: s.stateName,
    seqNo: s.seqNo,
    description: s.description ?? null,
    required: fromYesNo(s.required),
    status: s.status ?? 'Pending',
    estimatedDays: s.estimatedDays ?? null,
    refProjectId: s.refProjectId ?? null,
    refProjectNo: null,
    refProjectName: null,
    refPctOverall: 0,
    pctComplete: extra.pctComplete ?? 0,
    latestRemark: extra.latestRemark ?? '',
    createUser: s.createUser,
    createDate: s.createDate as Date,
    updateUser: s.updateUser ?? null,
    updateDate: s.updateDate ?? null,
  };
}

export function docToDto(d: ProjectDocWorkflow, stateName?: string | null): ProjectDocDto {
  return {
    docWfId: d.docWfId,
    projStateId: d.projStateId,
    projectId: d.projectId,
    stateName: stateName ?? null,
    masterDocId: d.docId ?? null,
    name: d.docName,
    docType: d.docType ?? null,
    required: fromYesNo(d.required),
    status: d.docStatus ?? 'Pending',
    remark: d.remark ?? null,
    seqNo: d.seqNo ?? 1,
    createUser: d.createUser,
    createDate: d.createDate as Date,
    updateUser: d.updateUser ?? null,
    updateDate: d.updateDate ?? null,
  };
}

export function memberToDto(m: ProjectMember): ProjectMemberDto {
  return {
    memberId: m.memberId,
    projectId: m.projectId,
    name: m.memberName,
    memberType: memberTypeCodeOf(m.memberType),
    memberTypeName: m.memberType ?? null,
    role: m.role,
    departmentCode: m.departmentCode ?? null,
    createUser: m.createUser ?? null,
    createDate: m.createDate ?? null,
  };
}

export function stateMemberToDto(m: ProjectStateMember, notifyCount = 0): StateMemberDto {
  return {
    stateMemberId: m.stateMemberId,
    projStateId: m.projStateId,
    projectId: m.projectId,
    name: m.memberName,
    memberType: memberTypeCodeOf(m.memberType),
    memberTypeName: m.memberType ?? null,
    role: m.role,
    notifyCount,
    createUser: m.createUser ?? null,
    createDate: m.createDate ?? null,
  };
}
