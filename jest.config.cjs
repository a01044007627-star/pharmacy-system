/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest")

const createJestConfig = nextJest({ dir: "./" })

const config = {
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/src/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
}

module.exports = createJestConfig(config)
