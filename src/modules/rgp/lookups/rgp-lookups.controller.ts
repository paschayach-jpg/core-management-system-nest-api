import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  EmployeeLookupDto,
  EmployeeLookupQueryDto,
  MasterDocumentDto,
  MasterDocumentQueryDto,
  MasterDocumentTypeDto,
  OrgLookupDto,
} from './dto/lookup.dto';
import { RgpLookupsService } from './rgp-lookups.service';

// รายการสำหรับ dropdown ของหน้าจอ RGP — ทุกคนที่ login อ่านได้ (ไม่มีข้อมูลอ่อนไหว: เฉพาะชื่อผู้ใช้ AD และชื่อหน่วยงาน)

@ApiTags('RGP')
@ApiBearerAuth()
@Controller('rgp/lookups')
export class RgpLookupsController {
  constructor(private readonly service: RgpLookupsService) {}

  @Get('employees')
  @ApiOperation({
    summary: 'พนักงานที่ยังทำงานอยู่ (ชื่อผู้ใช้ AD) สำหรับเลือกผู้รับผิดชอบ/บุคคลที่เกี่ยวข้อง',
  })
  @ApiOkResponse({ type: [EmployeeLookupDto] })
  employees(@Query() q: EmployeeLookupQueryDto): Promise<EmployeeLookupDto[]> {
    return this.service.employeeList(q.q);
  }

  @Get('sub-committees')
  @ApiOperation({ summary: 'คณะกรรมการ (EMS.m_SubCommittee) ที่ใช้งานอยู่' })
  @ApiOkResponse({ type: [OrgLookupDto] })
  subCommittees(): Promise<OrgLookupDto[]> {
    return this.service.subCommitteeList();
  }

  @Get('divisions')
  @ApiOperation({ summary: 'ฝ่าย (EMS.m_Division) ที่ใช้งานอยู่' })
  @ApiOkResponse({ type: [OrgLookupDto] })
  divisions(): Promise<OrgLookupDto[]> {
    return this.service.divisionList();
  }

  @Get('departments')
  @ApiOperation({ summary: 'แผนก (EMS.m_Department) ที่ใช้งานอยู่' })
  @ApiOkResponse({ type: [OrgLookupDto] })
  departments(): Promise<OrgLookupDto[]> {
    return this.service.departmentList();
  }

  @Get('master-documents')
  @ApiOperation({ summary: 'เอกสารมาสเตอร์ (BUI_RG.dbo.m_document) — กรองตามประเภทได้' })
  @ApiOkResponse({ type: [MasterDocumentDto] })
  masterDocuments(@Query() q: MasterDocumentQueryDto): Promise<MasterDocumentDto[]> {
    return this.service.masterDocuments(q.docTypeId);
  }

  @Get('master-document-types')
  @ApiOperation({ summary: 'ประเภทเอกสารมาสเตอร์ (BUI_RG.dbo.m_document_type)' })
  @ApiOkResponse({ type: [MasterDocumentTypeDto] })
  masterDocumentTypes(): Promise<MasterDocumentTypeDto[]> {
    return this.service.masterDocumentTypes();
  }
}
