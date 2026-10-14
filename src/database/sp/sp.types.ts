/** นิยาม Stored Procedure แบบมีชนิด — ตัวจริงสร้างโดย tools/codegen/generate-sp-catalog.ts */
export interface SpParamMeta {
  /** ชื่อพารามิเตอร์ไม่รวม @ */
  name: string;
  /** ชนิด SQL เช่น INT, NVARCHAR(200), BIT */
  sqlType: string;
  /** true = ไม่มีค่า default ใน SP (ต้องส่งค่า — ส่ง null ได้) */
  required: boolean;
  /** true = OUTPUT parameter */
  output: boolean;
}

export interface SpDef<
  TIn extends object = Record<string, unknown>,
  TOut extends object = Record<string, never>,
> {
  readonly name: string;
  readonly params: readonly SpParamMeta[];
  /** phantom type (ไม่มีค่าจริง) */
  readonly __in?: TIn;
  readonly __out?: TOut;
}

export function defineSp<TIn extends object, TOut extends object = Record<string, never>>(
  name: string,
  params: readonly SpParamMeta[],
): SpDef<TIn, TOut> {
  return { name, params };
}
