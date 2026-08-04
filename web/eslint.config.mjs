import nextConfig from "eslint-config-next";
import i18nPlugin from "./eslint/i18n-plugin.mjs";
import jsdoc from "eslint-plugin-jsdoc";

const config = [
  ...nextConfig,
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    plugins: {
      i18n: i18nPlugin,
      jsdoc,
    },
    rules: {
      // During migration keep as warning; change to "error" once phase2/3 complete.
      "i18n/no-literal-ui-text": "warn",
      // Issue #11: TSDoc enforcement (warnings during migration).
      // Enforces JSDoc/TSDoc on exported functions/classes/components.
      // Skip barrel index.ts, test files, and thin wrappers via settings.
      "jsdoc/require-jsdoc": "warn",
      "jsdoc/require-param": "warn",
      "jsdoc/require-returns": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      // Issue #11: skip barrel files and test files from jsdoc enforcement.
      "**/index.ts",
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
    ],
  },
];

export default config;
