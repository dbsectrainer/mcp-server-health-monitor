import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Promise: "readonly",
        Date: "readonly",
        Math: "readonly",
        JSON: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        Error: "readonly",
        String: "readonly",
        Number: "readonly",
        Boolean: "readonly",
        Object: "readonly",
        Array: "readonly",
        RegExp: "readonly",
        Map: "readonly",
        Set: "readonly",
        Symbol: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
