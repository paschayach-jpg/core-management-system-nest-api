import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { CrudLogService } from '../../../core/crud-log/crud-log.service';
import { CrudLoggedService } from '../../../core/crud-log/crud-logged.service';
import { Employee } from '../../shared/entities/employee.entity';
import { HrDepartment } from '../../shared/entities/hr-department.entity';
import { HrDivision } from '../../shared/entities/hr-division.entity';
import { SubCommittee } from '../../shared/entities/sub-committee.entity';
import { MasterDocument } from '../entities/master-document.entity';
import { MasterDocumentType } from '../entities/master-document-type.entity';
import type {
  EmployeeLookupDto,
  MasterDocumentDto,
  MasterDocumentTypeDto,
  OrgLookupDto,
} from './dto/lookup.dto';

/**
 * รายการสำหรับ dropdown ของหน้าจอ RGP (อ่านอย่างเดียว):
 *  - พนักงาน (EMS.m_Employee) · คณะกรรมการ/ฝ่าย/แผนก (EMS.m_SubCommittee/m_Division/m_Department)
 *  - เอกสารมาสเตอร์ + ประเภทเอกสาร (BUI_RG.dbo.m_document / m_document_type — DataSource 'project')
 * ระบบเดิมดึง 3 ตารางแรกผ่าน BisDb (ชี้กลับฐาน CMS_DB เดิม) — ที่นี่อ่านจากฐานหลักโดยตรง
 */
@Injectable()
export class RgpLookupsService extends CrudLoggedService {
  protected readonly logModule = 'RGP' as const;
  protected readonly logEntity = 'RgpLookup';

  constructor(
    crudLog: CrudLogService,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(SubCommittee) private readonly subCommittees: Repository<SubCommittee>,
    @InjectRepository(HrDivision) private readonly divisions: Repository<HrDivision>,
    @InjectRepository(HrDepartment) private readonly departments: Repository<HrDepartment>,
    @InjectRepository(MasterDocument, 'project') private readonly docs: Repository<MasterDocument>,
    @InjectRepository(MasterDocumentType, 'project')
    private readonly docTypes: Repository<MasterDocumentType>,
  ) {
    super(crudLog);
  }

  /** พนักงานที่ยังทำงานอยู่และมีชื่อผู้ใช้ AD (GetActiveADUsers) — ค้นด้วย q ได้ (ชื่อผู้ใช้/ชื่อ-สกุล) */
  async employeeList(q?: string): Promise<EmployeeLookupDto[]> {
    const rows = await this.employees.find({
      where: { isActive: true, isAnonymized: false, adUserName: Not(IsNull()) },
      select: { employeeId: true, adUserName: true, fullNameTh: true },
      order: { adUserName: 'ASC' },
    });
    const term = q?.trim().toLowerCase();
    return rows
      .filter((r) => (r.adUserName ?? '').trim() !== '')
      .filter(
        (r) =>
          !term ||
          (r.adUserName ?? '').toLowerCase().includes(term) ||
          (r.fullNameTh ?? '').toLowerCase().includes(term),
      )
      .map((r) => ({ adUserName: r.adUserName as string, fullNameTh: r.fullNameTh ?? null }));
  }

  async subCommitteeList(): Promise<OrgLookupDto[]> {
    const rows = await this.subCommittees.find({
      where: { isActive: true, isDeleted: false },
      order: { subCommitteeNameTh: 'ASC' },
    });
    return rows.map((r) => ({ id: r.subCommitteeId, name: r.subCommitteeNameTh, code: null }));
  }

  async divisionList(): Promise<OrgLookupDto[]> {
    const rows = await this.divisions.find({
      where: { isActive: true },
      order: { divisionName: 'ASC' },
    });
    return rows.map((r) => ({ id: r.divisionId, name: r.divisionName, code: r.divisionCode }));
  }

  async departmentList(): Promise<OrgLookupDto[]> {
    const rows = await this.departments.find({
      where: { isActive: true },
      order: { departmentName: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.departmentId,
      name: r.departmentName,
      code: r.departmentCode,
    }));
  }

  /** เอกสารมาสเตอร์ (GetMasterDocuments) เรียงตามชื่อ — กรองตามประเภทได้ */
  async masterDocuments(docTypeId?: number): Promise<MasterDocumentDto[]> {
    const rows = await this.docs.find({
      where: docTypeId !== undefined ? { docTypeId } : {},
      order: { docName: 'ASC' },
    });
    return rows.map((r) => ({
      docId: r.docId,
      docCode: r.docCode ?? null,
      docName: r.docName ?? null,
      docTypeId: r.docTypeId ?? null,
      displayName: `${r.docCode ?? ''} - ${r.docName ?? ''}`,
    }));
  }

  async masterDocumentTypes(): Promise<MasterDocumentTypeDto[]> {
    const rows = await this.docTypes.find({ order: { docTypeName: 'ASC' } });
    return rows.map((r) => ({ docTypeId: r.docTypeId, docTypeName: r.docTypeName ?? null }));
  }
}
