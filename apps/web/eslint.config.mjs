import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Destructuring a field out to drop it (`const { settings: _s, ...rest }`)
  // is not an unused variable.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // What `pnpm cookbook sandbox` bundles for its harness (#736):
    ".cache/**",
    // The composed-page bench's fixture recipe (#869): a pen, linted by
    // `pnpm cookbook lint` as cookbook/ pens are.
    "src/lib/cookbook/fixtures/recipes/**",
  ]),
]);

export default eslintConfig;
