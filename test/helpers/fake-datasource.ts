/** DataSource ปลอมสำหรับเทสต์ที่ไม่มี SQL Server: พอให้ DI ของ TypeORM/Repository ผ่านและให้ query() คืนค่าที่กำหนดได้ */
export function fakeDataSource(queryImpl: (sql: string, params?: unknown[]) => unknown = () => []) {
  const repoStub = new Proxy(
    {},
    {
      get: (_t, prop) => {
        // 'then' / symbol ต้องเป็น undefined เพื่อไม่ให้ Nest คิดว่าเป็น Promise
        if (prop === 'then' || typeof prop === 'symbol' || /^(on|before)[A-Z]/.test(prop))
          return undefined; // Promise / lifecycle hook ของ Nest
        return () => {
          throw new Error(
            `Repository ปลอม: เรียก ${String(prop)}() — ต้อง override ใน test ที่ใช้`,
          );
        };
      },
    },
  );
  const ds: Record<string, unknown> = {
    isInitialized: false,
    entityMetadatas: [],
    options: { type: 'mssql' },
    driver: { mssql: {}, master: {} },
    getRepository: () => repoStub,
    query: async (sql: string, params?: unknown[]) => queryImpl(sql, params),
    createQueryRunner: () => ({}),
    destroy: async () => undefined,
  };
  ds.manager = { connection: ds };
  return ds;
}
