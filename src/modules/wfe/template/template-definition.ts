import { WorkflowStepType } from '../../../common/constants/enums';
import { MAX_TEMPLATE_DEFINITION_CHARS } from '../common/wfe.constants';

/**
 * Pure functions ของ "ผังขั้นตอน" ของ template — ไม่แตะ DB:
 *  - อ่าน TemplateDefinition (JSON ที่ designer/wizard เก็บ) → รายการ step + connection
 *  - ตรวจความถูกต้องของกราฟ (มี Start/End, ไม่มี step ลอย, เดินจาก Start ถึง End ได้)
 *
 * TemplateDefinition มี 2 รูปแบบในระบบเดิม (ดู WorkflowDesignerPresenter.LoadTemplateDefinition):
 *  - designer: `{ Steps:[{WorkflowStepId,StepName,StepType:"Approval",AssignedUser,SLADays,...}], Connections:[{FromStepId,ToStepId,Condition}] }`
 *  - wizard:   `{ Steps:[{StepNumber,StepName,Action:"Approve",NextStep:"ชื่อ step ถัดไป"}], Approvers:[...], ... }`
 * key ของ JSON เป็น PascalCase (Newtonsoft) — รับ camelCase ด้วยเพื่อให้ client ใหม่ส่งได้
 */

export interface DesignStep {
  /** รหัสใน layout (WorkflowStepId ของ designer / StepNumber ของ wizard) — ไม่ใช่ WFStepId ใน DB */
  key: number;
  stepName: string;
  stepType: WorkflowStepType;
  /** ลำดับ (1..n ตามลำดับใน array — ตรงกับ SequenceNumber ที่ Sync เดิมใส่) */
  sequenceNumber: number;
  assignedUser: string | null;
  description: string | null;
  slaDays: number | null;
  allowDelegation: boolean;
}

export interface DesignConnection {
  fromKey: number;
  toKey: number;
  condition: string | null;
  sequenceNumber: number;
}

export interface ParsedDefinition {
  format: 'designer' | 'wizard';
  steps: DesignStep[];
  connections: DesignConnection[];
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** อ่านค่าด้วยชื่อ PascalCase หรือ camelCase */
function pick(o: Json, ...names: string[]): unknown {
  for (const n of names) {
    if (o[n] !== undefined && o[n] !== null) return o[n];
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function int(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/** ชื่อชนิด step จาก designer → enum (พอร์ตจาก WorkflowService.MapStringToStepType; ชนิดที่ไม่รู้จัก = Approval) */
export function mapStepTypeLabel(raw: unknown): WorkflowStepType {
  if (typeof raw === 'number' && raw >= 1 && raw <= 8) return raw as WorkflowStepType;
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (/^[1-8]$/.test(s)) return Number(s) as WorkflowStepType;
  switch (s) {
    case 'start':
      return WorkflowStepType.Start;
    case 'end':
      return WorkflowStepType.End;
    case 'approval':
      return WorkflowStepType.Approval;
    case 'review':
      return WorkflowStepType.Review;
    case 'notification':
      return WorkflowStepType.Notification;
    case 'decision':
      return WorkflowStepType.Decision;
    case 'parallel':
      return WorkflowStepType.Parallel;
    case 'merge':
      return WorkflowStepType.Merge;
    // sub-workflow / system task / wait timer ถูกแมปเป็น Approval ในระบบเดิม
    default:
      return WorkflowStepType.Approval;
  }
}

/** Action ของ wizard → ชนิด step (พอร์ตจาก WorkflowDesignerPresenter.MapWizardActionToDesignerType) */
function mapWizardAction(action: unknown): WorkflowStepType {
  const a = String(action ?? '').toLowerCase();
  if (!a) return WorkflowStepType.Approval;
  if (a.includes('review')) return WorkflowStepType.Review;
  if (a.includes('notify')) return WorkflowStepType.Notification;
  if (a.includes('decision')) return WorkflowStepType.Decision;
  if (a.includes('start')) return WorkflowStepType.Start;
  if (a.includes('end')) return WorkflowStepType.End;
  return WorkflowStepType.Approval;
}

/**
 * ตรวจ TemplateDefinition ที่ client ส่งมา — คืนข้อความ error (ภาษาไทย) หรือ null ถ้าใช้ได้
 * ว่าง/null ใช้ได้ (ระบบเดิมส่ง "{}" เมื่อยังไม่มีผัง)
 */
export function checkTemplateDefinitionJson(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  if (raw.length > MAX_TEMPLATE_DEFINITION_CHARS)
    return `TemplateDefinition ยาวเกิน ${MAX_TEMPLATE_DEFINITION_CHARS} ตัวอักษร`;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v)) return 'TemplateDefinition ต้องเป็น JSON object';
  } catch {
    return 'TemplateDefinition ไม่ใช่ JSON ที่ถูกต้อง';
  }
  return null;
}

/**
 * แปลง TemplateDefinition เป็นรายการ step/connection — คืน null ถ้าว่าง/อ่านไม่ได้/ไม่มี step
 * (ไม่ throw: ระบบเดิมจับ exception แล้วถือว่าไม่มีข้อมูล)
 */
export function parseTemplateDefinition(raw: string | null | undefined): ParsedDefinition | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(root)) return null;
  const stepsRaw = pick(root, 'Steps', 'steps');
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null;
  const items = stepsRaw.filter(isObject);
  if (items.length === 0) return null;

  const isWizard = items.some(
    (s) =>
      (pick(s, 'Action', 'action') !== undefined ||
        pick(s, 'NextStep', 'nextStep') !== undefined) &&
      pick(s, 'StepType', 'stepType') === undefined,
  );
  return isWizard ? parseWizard(items) : parseDesigner(items, root);
}

function parseDesigner(items: Json[], root: Json): ParsedDefinition {
  const steps: DesignStep[] = items.map((s, i) => {
    const slaDays = int(pick(s, 'SLADays', 'slaDays'));
    return {
      key: int(pick(s, 'WorkflowStepId', 'workflowStepId')) ?? i + 1,
      stepName: str(pick(s, 'StepName', 'stepName')) ?? `Step ${i + 1}`,
      stepType: mapStepTypeLabel(pick(s, 'StepType', 'stepType')),
      sequenceNumber: i + 1,
      assignedUser: str(pick(s, 'AssignedUser', 'assignedUser')),
      description: str(pick(s, 'Description', 'description')),
      slaDays: slaDays !== null && slaDays > 0 ? slaDays : null,
      // "Allow Forward" ใน designer = ปุ่มส่งต่อ/มอบหมายงาน (WorkflowDashboardFormNew: AllowForward = task.CanDelegate)
      allowDelegation:
        pick(s, 'AllowForward', 'allowForward', 'AllowDelegation', 'allowDelegation') === true,
    };
  });
  const connsRaw = pick(root, 'Connections', 'connections');
  const connections: DesignConnection[] = [];
  if (Array.isArray(connsRaw)) {
    let seq = 1;
    for (const c of connsRaw.filter(isObject)) {
      const from = int(pick(c, 'FromStepId', 'fromStepId'));
      const to = int(pick(c, 'ToStepId', 'toStepId'));
      if (from === null || to === null) continue;
      connections.push({
        fromKey: from,
        toKey: to,
        condition: str(
          pick(c, 'Condition', 'condition', 'ConditionExpression', 'conditionExpression'),
        ),
        sequenceNumber: seq++,
      });
    }
  }
  return { format: 'designer', steps, connections };
}

function parseWizard(items: Json[]): ParsedDefinition {
  const ordered = items
    .map((s, i) => ({ s, i, no: int(pick(s, 'StepNumber', 'stepNumber')) ?? i + 1 }))
    .sort((a, b) => a.no - b.no || a.i - b.i);
  const keyByName = new Map<string, number>();
  const steps: DesignStep[] = ordered.map(({ s }, idx) => {
    const name = str(pick(s, 'StepName', 'stepName')) ?? `Step ${idx + 1}`;
    const key = idx + 1;
    if (!keyByName.has(name.toLowerCase())) keyByName.set(name.toLowerCase(), key);
    return {
      key,
      stepName: name,
      stepType: mapWizardAction(pick(s, 'Action', 'action')),
      sequenceNumber: key,
      assignedUser: null,
      description: str(pick(s, 'Action', 'action')),
      slaDays: null,
      allowDelegation: false,
    };
  });
  const connections: DesignConnection[] = [];
  let seq = 1;
  ordered.forEach(({ s }, idx) => {
    const next = str(pick(s, 'NextStep', 'nextStep'));
    if (!next) return;
    const to = keyByName.get(next.toLowerCase());
    if (to === undefined) return;
    connections.push({ fromKey: idx + 1, toKey: to, condition: null, sequenceNumber: seq++ });
  });
  return { format: 'wizard', steps, connections };
}

// ───────────────────────── ตรวจกราฟ ─────────────────────────

export interface GraphNode {
  key: number;
  name: string;
  type: WorkflowStepType;
  sequence: number;
}

export interface GraphEdge {
  from: number;
  to: number;
}

export type GraphIssueCode =
  | 'NO_STEPS'
  | 'NO_START'
  | 'MULTIPLE_START'
  | 'NO_END'
  | 'DUPLICATE_STEP_KEY'
  | 'CONNECTION_UNKNOWN_STEP'
  | 'CONNECTION_SELF_LOOP'
  | 'CONNECTION_DUPLICATE'
  | 'SEQUENTIAL_FALLBACK'
  | 'FLOATING_STEP'
  | 'DEAD_END'
  | 'UNREACHABLE_FROM_START'
  | 'NO_PATH_TO_END'
  | 'START_HAS_INCOMING'
  | 'END_HAS_OUTGOING';

export interface GraphIssue {
  severity: 'error' | 'warning';
  code: GraphIssueCode;
  message: string;
  /** step ที่เกี่ยวข้อง (key เดียวกับ GraphNode.key) */
  stepKey?: number;
}

export interface GraphValidation {
  valid: boolean;
  issues: GraphIssue[];
}

const label = (n: GraphNode) => `'${n.name}'`;

/** เส้นเชื่อมโดยปริยายเมื่อ template ไม่มี connection เลย: เรียงตาม sequence แล้วต่อกันเป็นสายเดียว (ตรงกับ sequential fallback ตอนรัน) */
export function sequentialEdges(nodes: readonly GraphNode[]): GraphEdge[] {
  const sorted = [...nodes].sort((a, b) => a.sequence - b.sequence || a.key - b.key);
  const out: GraphEdge[] = [];
  for (let i = 0; i + 1 < sorted.length; i++)
    out.push({ from: sorted[i].key, to: sorted[i + 1].key });
  return out;
}

/**
 * ตรวจกราฟของ template ก่อนส่งอนุมัติ/เผยแพร่
 * error = ห้ามผ่าน · warning = เตือนเฉยๆ
 */
export function validateGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): GraphValidation {
  const issues: GraphIssue[] = [];
  const add = (
    severity: GraphIssue['severity'],
    code: GraphIssueCode,
    message: string,
    stepKey?: number,
  ) => issues.push({ severity, code, message, stepKey });
  const result = (): GraphValidation => ({
    valid: !issues.some((i) => i.severity === 'error'),
    issues,
  });

  if (nodes.length === 0) {
    add('error', 'NO_STEPS', 'Template ไม่มีขั้นตอน (step) เลย');
    return result();
  }

  // รหัส step ซ้ำ
  const byKey = new Map<number, GraphNode>();
  for (const n of nodes) {
    if (byKey.has(n.key)) add('error', 'DUPLICATE_STEP_KEY', `รหัสขั้นตอน ${n.key} ซ้ำกัน`, n.key);
    else byKey.set(n.key, n);
  }

  const starts = nodes.filter((n) => n.type === WorkflowStepType.Start);
  const ends = nodes.filter((n) => n.type === WorkflowStepType.End);
  if (starts.length === 0) add('error', 'NO_START', 'Template ต้องมีขั้นตอนเริ่มต้น (Start)');
  if (starts.length > 1)
    add(
      'error',
      'MULTIPLE_START',
      `Template มีขั้นตอน Start ${starts.length} ตัว — ต้องมีเพียงตัวเดียว (ระบบเริ่มจาก Start ตัวแรก)`,
    );
  if (ends.length === 0) add('error', 'NO_END', 'Template ต้องมีขั้นตอนสิ้นสุด (End)');

  // connection ที่ใช้ได้
  const seen = new Set<string>();
  let valid: GraphEdge[] = [];
  for (const e of edges) {
    if (!byKey.has(e.from) || !byKey.has(e.to)) {
      add(
        'error',
        'CONNECTION_UNKNOWN_STEP',
        `เส้นเชื่อม ${e.from} → ${e.to} อ้างถึงขั้นตอนที่ไม่มีอยู่`,
      );
      continue;
    }
    if (e.from === e.to) {
      add(
        'error',
        'CONNECTION_SELF_LOOP',
        `เส้นเชื่อมของขั้นตอน ${label(byKey.get(e.from)!)} วนกลับหาตัวเอง`,
        e.from,
      );
      continue;
    }
    const id = `${e.from}>${e.to}`;
    if (seen.has(id)) {
      add('warning', 'CONNECTION_DUPLICATE', `เส้นเชื่อม ${e.from} → ${e.to} ซ้ำกัน`, e.from);
      continue;
    }
    seen.add(id);
    valid.push(e);
  }

  // ไม่มีเส้นเชื่อมเลย → ระบบเดินตามลำดับ SequenceNumber (sequential fallback)
  if (valid.length === 0 && edges.length === 0 && byKey.size > 1) {
    valid = sequentialEdges([...byKey.values()]);
    add(
      'warning',
      'SEQUENTIAL_FALLBACK',
      'Template ไม่มีเส้นเชื่อม — ระบบจะเดินตามลำดับ (SequenceNumber) ของขั้นตอน',
    );
  }

  const out = new Map<number, number[]>();
  const inc = new Map<number, number[]>();
  for (const n of byKey.values()) {
    out.set(n.key, []);
    inc.set(n.key, []);
  }
  for (const e of valid) {
    out.get(e.from)!.push(e.to);
    inc.get(e.to)!.push(e.from);
  }

  // step ลอย: ไม่มีเส้นเข้าและไม่มีเส้นออก (เมื่อมี step มากกว่า 1)
  const floating = new Set<number>();
  if (byKey.size > 1) {
    for (const n of byKey.values()) {
      if (out.get(n.key)!.length === 0 && inc.get(n.key)!.length === 0) {
        floating.add(n.key);
        add(
          'error',
          'FLOATING_STEP',
          `ขั้นตอน ${label(n)} ลอยอยู่ ไม่ได้เชื่อมกับขั้นตอนใดเลย`,
          n.key,
        );
      }
    }
  }

  for (const n of byKey.values()) {
    if (n.type === WorkflowStepType.Start && inc.get(n.key)!.length > 0)
      add('warning', 'START_HAS_INCOMING', `ขั้นตอน Start ${label(n)} มีเส้นเชื่อมเข้า`, n.key);
    if (n.type === WorkflowStepType.End && out.get(n.key)!.length > 0)
      add('warning', 'END_HAS_OUTGOING', `ขั้นตอน End ${label(n)} มีเส้นเชื่อมออก`, n.key);
  }

  // ตันทาง: ไม่ใช่ End แต่ไม่มีทางไปต่อ
  const deadEnds = new Set<number>();
  if (byKey.size > 1) {
    for (const n of byKey.values()) {
      if (n.type !== WorkflowStepType.End && out.get(n.key)!.length === 0 && !floating.has(n.key)) {
        deadEnds.add(n.key);
        add('error', 'DEAD_END', `ขั้นตอน ${label(n)} ไม่มีทางไปต่อและไม่ใช่ขั้นตอน End`, n.key);
      }
    }
  }

  // เดินจาก Start ไปให้ถึงทุกขั้นตอน
  const reach = (seeds: number[], next: Map<number, number[]>): Set<number> => {
    const seenNodes = new Set<number>(seeds);
    const stack = [...seeds];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nx of next.get(cur) ?? []) {
        if (!seenNodes.has(nx)) {
          seenNodes.add(nx);
          stack.push(nx);
        }
      }
    }
    return seenNodes;
  };

  if (starts.length > 0) {
    const fromStart = reach(
      starts.map((s) => s.key),
      out,
    );
    for (const n of byKey.values()) {
      if (!fromStart.has(n.key) && !floating.has(n.key))
        add('error', 'UNREACHABLE_FROM_START', `เดินจาก Start ไปไม่ถึงขั้นตอน ${label(n)}`, n.key);
    }
    if (ends.length > 0) {
      const toEnd = reach(
        ends.map((e) => e.key),
        inc,
      );
      for (const n of byKey.values()) {
        if (fromStart.has(n.key) && !toEnd.has(n.key) && !deadEnds.has(n.key))
          add('error', 'NO_PATH_TO_END', `จากขั้นตอน ${label(n)} เดินไปถึง End ไม่ได้`, n.key);
      }
    }
  }

  return result();
}

/** แปลง step/connection ที่ parse จาก definition เป็นโหนด/เส้นสำหรับ validateGraph */
export function graphFromDefinition(def: ParsedDefinition): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  return {
    nodes: def.steps.map((s) => ({
      key: s.key,
      name: s.stepName,
      type: s.stepType,
      sequence: s.sequenceNumber,
    })),
    edges: def.connections.map((c) => ({ from: c.fromKey, to: c.toKey })),
  };
}
