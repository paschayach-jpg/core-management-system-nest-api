import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: 'src/.*\\.spec\\.ts$|test/(unit|architecture)/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] },
  moduleNameMapper: { '^@app/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.generated.ts', '!src/modules/*/entities/**', '!src/main.ts'],
  coverageDirectory: 'coverage',
  setupFiles: ['<rootDir>/test/setup.ts'],
};

export default config;
